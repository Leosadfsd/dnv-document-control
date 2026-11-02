import { DATABASE_NAME, DATABASE_VERSION } from '../domain/contracts';
import { emptyState } from '../domain/model';
import type { ToolState, InputKind } from '../domain/model';
import { validateCatalog } from '../domain/rules';
import { unzipSync } from 'fflate';
import { base64ToBytes } from '../domain/model';

const stores = ['meta', 'catalog', 'documents', 'comments', 'derived'];
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      for (const name of stores)
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('本地数据库无法打开'));
    request.onblocked = () => reject(new Error('其他标签页正在使用旧数据版本，请关闭后重试'));
  });
}
const asPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function loadState(): Promise<ToolState> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(stores, 'readonly');
    const values = await Promise.all(
      stores.map((store) => asPromise(tx.objectStore(store).get('active'))),
    );
    const meta = values[0];
    if (!meta) return emptyState();
    return {
      revision: meta.revision ?? 0,
      project: meta.project,
      operations: meta.operations ?? [],
      undo: values[4]?.undo ?? {},
      catalog: values[1]?.catalog ?? null,
      template: values[1]?.template ?? null,
      documents: values[2] ?? [],
      comments: values[3] ?? [],
    };
  } finally {
    db.close();
  }
}
export async function saveState(state: ToolState, only?: InputKind): Promise<number> {
  const db = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const changed = only ? ['meta', 'derived', only] : stores;
      const tx = db.transaction(changed, 'readwrite');
      tx.oncomplete = () => resolve(state.revision + 1);
      tx.onerror = () => reject(tx.error ?? new Error('本地保存失败，原数据保留'));
      tx.onabort = () => reject(tx.error ?? new Error('本地保存已取消，原数据保留'));
      const check = tx.objectStore('meta').get('active');
      check.onsuccess = () => {
        if ((check.result?.revision ?? 0) !== state.revision) {
          tx.abort();
          reject(new Error('本地资料已被其他页面更新，请刷新后重试'));
          return;
        }
        try {
          tx.objectStore('meta').put(
            { revision: state.revision + 1, project: state.project, operations: state.operations },
            'active',
          );
          if (!only || only === 'catalog')
            tx.objectStore('catalog').put(
              { catalog: state.catalog, template: state.template },
              'active',
            );
          if (!only || only === 'documents')
            tx.objectStore('documents').put(state.documents, 'active');
          if (!only || only === 'comments')
            tx.objectStore('comments').put(state.comments, 'active');
          tx.objectStore('derived').put({ undo: state.undo }, 'active');
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
    });
  } finally {
    db.close();
  }
}

export function exportBackup(state: ToolState): string {
  return JSON.stringify({
    format: 'dnv-tool-backup',
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    ...state,
  });
}
export function validateBackup(text: string): ToolState {
  if (text.length > 80 * 1024 * 1024) throw new Error('备份超过80 MB限制');
  const value = JSON.parse(text);
  if (value?.format !== 'dnv-tool-backup' || value.schemaVersion !== 1)
    throw new Error('不是受支持的船检备份格式');
  const p = value.project;
  if (
    !p ||
    typeof p.name !== 'string' ||
    typeof p.projectKey !== 'string' ||
    !p.projectKey ||
    !/^\d+$/.test(p.projectId)
  )
    throw new Error('备份项目信息无效');
  if (
    value.catalog &&
    (!validateCatalog(value.catalog.catalog).canSave ||
      value.catalog.catalog.projectKey !== p.projectKey ||
      !Array.isArray(value.catalog.followed) ||
      !value.catalog.overrides ||
      typeof value.catalog.overrides !== 'object')
  )
    throw new Error('基础资料格式或项目不一致');
  if (value.catalog) {
    const ids = new Set(
      value.catalog.catalog.drawings.map((d: { drawingNo: string }) => d.drawingNo),
    );
    const statistics = value.catalog.statistics;
    if (
      statistics &&
      (!Array.isArray(statistics.excludedDrawingNos) ||
        statistics.excludedDrawingNos.some((no: unknown) => typeof no !== 'string' || !ids.has(no)))
    )
      throw new Error('统计排除图号不在基础资料中');
    if (
      value.catalog.followed.some((no: string) => !ids.has(no)) ||
      Object.keys(value.catalog.overrides).some((no) => !ids.has(no))
    )
      throw new Error('关注图号或人工修正不在基础资料中');
  }
  for (const kind of ['documents', 'comments']) {
    if (!Array.isArray(value[kind]) || value[kind].length > 2)
      throw new Error('快照数量或格式无效');
    for (const snapshot of value[kind]) {
      if (
        snapshot.projectKey !== p.projectKey ||
        snapshot.source?.kind !== kind ||
        !snapshot.source?.scope ||
        !Array.isArray(snapshot.missingFromLatest) ||
        !Array.isArray(snapshot.issues) ||
        typeof snapshot.snapshotId !== 'string'
      )
        throw new Error('快照来源或项目无效');
      if (
        snapshot.missingFromLatest.some((k: unknown) => typeof k !== 'string') ||
        (snapshot.missingLinks &&
          (!Array.isArray(snapshot.missingLinks) ||
            snapshot.missingLinks.some(
              (l: { messageId: string; drawingNo: string; revision: string }) =>
                !l ||
                typeof l.messageId !== 'string' ||
                typeof l.drawingNo !== 'string' ||
                typeof l.revision !== 'string',
            ))) ||
        typeof snapshot.source.filename !== 'string' ||
        typeof snapshot.source.importedAt !== 'string' ||
        typeof snapshot.source.fingerprint !== 'string' ||
        !['all', 'partial', 'unconfirmed'].includes(snapshot.source.scope.project) ||
        !['all', 'partial', 'unconfirmed'].includes(snapshot.source.scope.revisions) ||
        !['all', 'open-only', 'partial', 'unconfirmed'].includes(snapshot.source.scope.statuses) ||
        typeof snapshot.source.scope.confirmedByUser !== 'boolean'
      )
        throw new Error('快照范围或缺失关联无效');
      const rows = kind === 'documents' ? snapshot.data : snapshot.data?.messages;
      if (!Array.isArray(rows) || rows.length > 100000) throw new Error('快照内容无效');
      const keys = new Set<string>();
      for (const r of rows) {
        if (!r || typeof r !== 'object') throw new Error('快照记录无效');
        const key =
          kind === 'documents'
            ? JSON.stringify([r.drawingNo, r.revision, r.sent?.iso ?? r.sent?.raw])
            : r.messageId;
        if (keys.has(key)) throw new Error('备份包含重复身份');
        keys.add(key);
        const dates =
          kind === 'documents' ? [r.sent, r.received] : [r.issueDate, r.lastActivity, r.closedDate];
        if (
          dates.some(
            (d) =>
              !d ||
              typeof d.raw !== 'string' ||
              !(
                d.iso === null ||
                (typeof d.iso === 'string' && Number.isFinite(Date.parse(d.iso)))
              ),
          ) ||
          !Array.isArray(r.sources) ||
          r.sources.some(
            (s: { row: number; sourceFingerprint: string }) =>
              !Number.isInteger(s.row) || s.row < 1 || typeof s.sourceFingerprint !== 'string',
          )
        )
          throw new Error('记录日期或来源无效');
        if (
          kind === 'documents' &&
          (r.projectKey !== p.projectKey ||
            typeof r.drawingNo !== 'string' ||
            !r.drawingNo ||
            !['status', 'title', 'revision', 'approvalStatus'].every(
              (k) => typeof r[k] === 'string',
            ) ||
            !(r.openComments === null || (Number.isInteger(r.openComments) && r.openComments >= 0)))
        )
          throw new Error('图纸记录项目或内容不一致');
        if (
          kind === 'comments' &&
          (r.projectId !== p.projectId ||
            typeof r.messageId !== 'string' ||
            !['parent', 'reply', 'unknown'].includes(r.kind) ||
            ![
              'status',
              'type',
              'title',
              'description',
              'discipline',
              'issuedByRole',
              'actionNeededBy',
            ].every((k) => typeof r[k] === 'string') ||
            !(r.sortOrder === null || Number.isSafeInteger(r.sortOrder)) ||
            !Array.isArray(r.superseded) ||
            !Array.isArray(r.links) ||
            r.links.some(
              (l: { drawingNo: string; revision: string }) =>
                typeof l.drawingNo !== 'string' || typeof l.revision !== 'string',
            ))
        )
          throw new Error('意见关联或项目不一致');
      }
      if (kind === 'comments') {
        const parents = new Set(
          rows
            .filter((m: { kind: string }) => m.kind === 'parent')
            .map((m: { messageId: string }) => m.messageId),
        );
        if (
          rows.some(
            (m: { parentId: string | null }) => m.parentId !== null && !parents.has(m.parentId),
          )
        )
          throw new Error('意见父子关联无效');
      }
    }
  }
  if (
    value.template &&
    (typeof value.template.base64 !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value.template.base64) ||
      atob(value.template.base64).slice(0, 2) !== 'PK' ||
      !value.template.sheetName ||
      !Number.isInteger(value.template.columnCount) ||
      value.template.columnCount < 1 ||
      !Number.isInteger(value.template.headerRow) ||
      !value.template.rows ||
      Object.values(value.template.rows).some((row) => !Number.isInteger(row) || Number(row) < 1))
  )
    throw new Error('原台账模板无效');
  if (value.template) {
    const files = unzipSync(base64ToBytes(value.template.base64));
    if (!files['xl/workbook.xml'] || !files['[Content_Types].xml'] || !files['xl/styles.xml'])
      throw new Error('原台账模板不完整');
  }
  const result: ToolState = {
    revision: 0,
    project: p,
    catalog: value.catalog ?? null,
    template: value.template ?? null,
    documents: value.documents,
    comments: value.comments,
    operations: Array.isArray(value.operations) ? value.operations.slice(-30) : [],
    undo: {},
  };
  for (const [kind, previous] of Object.entries(value.undo ?? {})) {
    if (
      !['catalog', 'documents', 'comments'].includes(kind) ||
      !previous ||
      typeof previous !== 'object'
    )
      throw new Error('撤销记录无效');
    const prior = previous as Record<string, unknown>;
    const validated = validateBackup(
      JSON.stringify({
        format: 'dnv-tool-backup',
        schemaVersion: 1,
        ...result,
        undo: {},
        ...(kind === 'catalog'
          ? { catalog: prior.catalog ?? null, template: prior.template ?? null }
          : { [kind]: prior[kind] }),
      }),
    );
    result.undo[kind as InputKind] =
      kind === 'catalog'
        ? { catalog: validated.catalog, template: validated.template }
        : kind === 'documents'
          ? { documents: validated.documents }
          : { comments: validated.comments };
  }
  return result;
}
