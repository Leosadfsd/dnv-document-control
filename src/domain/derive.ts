import type {
  CatalogState,
  CommentsData,
  DocumentRecord,
  Snapshot,
  Change,
  Comparison,
  CommentMessage,
} from './contracts';
import type { Summary, ToolState, PreparedImport, InputKind } from './model';
import { currentDocument, canCompareComplete } from './rules';

export const documentKey = (r: Pick<DocumentRecord, 'drawingNo' | 'revision' | 'sent'>) =>
  JSON.stringify([r.drawingNo, r.revision, r.sent.iso ?? r.sent.raw]);
export const messageKey = (r: Pick<CommentMessage, 'projectId' | 'messageId'>) =>
  JSON.stringify([r.projectId, r.messageId]);
export const isFull = (source: Snapshot<unknown>['source']) =>
  source.scope.confirmedByUser &&
  source.scope.project === 'all' &&
  source.scope.revisions === 'all' &&
  (source.kind !== 'comments' || source.scope.statuses === 'all');

const compare = <T>(
  before: Snapshot<T> | null,
  after: Snapshot<T>,
  changes: Change[],
): Comparison => ({
  confidence: !before
    ? 'first-data'
    : canCompareComplete(before.source, after.source)
      ? 'complete'
      : 'range-insufficient',
  beforeDate: before?.source.dataDate ?? null,
  afterDate: after.source.dataDate,
  changes,
});
export function compareDocuments(
  before: Snapshot<DocumentRecord[]> | null,
  after: Snapshot<DocumentRecord[]>,
): Comparison {
  if (after.lastImportUnchanged) return compare(before, after, []);
  if (!before) return compare(before, after, [{ kind: 'first-data', key: 'documents', links: [] }]);
  const groups = (records: DocumentRecord[]) => {
    const map = new Map<string, DocumentRecord[]>();
    for (const r of records) {
      if (!map.has(r.drawingNo)) map.set(r.drawingNo, []);
      map.get(r.drawingNo)!.push(r);
    }
    return map;
  };
  const old = groups(before.data),
    next = groups(after.data);
  const changes: Change[] = [];
  for (const [no, rows] of next) {
    const a = currentDocument(old.get(no) ?? []),
      b = currentDocument(rows);
    if (!b) continue;
    const links = [{ drawingNo: no, revision: b.revision }];
    if (!a || a.revision !== b.revision || a.sent.iso !== b.sent.iso)
      changes.push({ kind: 'version', key: no, links });
    if (a && a.status !== b.status) changes.push({ kind: 'status', key: no, links });
    if (a && (a.approvalStatus !== b.approvalStatus || a.received.iso !== b.received.iso))
      changes.push({ kind: 'approval', key: no, links });
  }
  for (const key of after.missingFromLatest) {
    const oldRecord = before.data.find((r) => documentKey(r) === key);
    if (oldRecord)
      changes.push({
        kind: 'not-found',
        key: oldRecord.drawingNo,
        links: [{ drawingNo: oldRecord.drawingNo, revision: oldRecord.revision }],
      });
  }
  return compare(before, after, changes);
}

export function compareComments(
  before: Snapshot<CommentsData> | null,
  after: Snapshot<CommentsData>,
): Comparison {
  if (after.lastImportUnchanged) return compare(before, after, []);
  if (!before) return compare(before, after, [{ kind: 'first-data', key: 'comments', links: [] }]);
  const old = new Map(before.data.messages.map((m) => [messageKey(m), m]));
  const changes: Change[] = [];
  for (const m of after.data.messages) {
    const prior = old.get(messageKey(m));
    if (!prior) {
      const kind: Change['kind'] =
        m.kind === 'parent'
          ? 'new-parent'
          : m.kind === 'unknown'
            ? 'unmatched'
            : ['Yard Design', 'Yard Site'].includes(m.issuedByRole)
              ? 'new-yard-reply'
              : ['Approval Expert', 'NB Surveyor'].includes(m.issuedByRole)
                ? 'new-dnv-reply'
                : 'new-other-reply';
      changes.push({ kind, key: m.messageId, links: m.links });
    } else if (m.kind === 'parent') {
      if (prior.status !== 'Closed' && m.status === 'Closed')
        changes.push({ kind: 'closed', key: m.messageId, links: m.links });
      if (prior.status === 'Closed' && m.status === 'Open')
        changes.push({ kind: 'reopened', key: m.messageId, links: m.links });
      if (prior.actionNeededBy !== m.actionNeededBy)
        changes.push({ kind: 'responsibility', key: m.messageId, links: m.links });
    }
    if (prior && (prior.description !== m.description || prior.title !== m.title))
      changes.push({ kind: 'message-update', key: m.messageId, links: m.links });
    if (prior && JSON.stringify(prior.links) !== JSON.stringify(m.links))
      changes.push({ kind: 'association', key: m.messageId, links: m.links });
  }
  for (const key of after.missingFromLatest) {
    const r = old.get(key);
    if (r) changes.push({ kind: 'not-found', key: r.messageId, links: r.links });
  }
  for (const link of after.missingLinks ?? [])
    changes.push({
      kind: 'not-found',
      key: link.messageId,
      links: [{ drawingNo: link.drawingNo, revision: link.revision }],
    });
  return compare(before, after, changes);
}

export function buildDrawingSummaries(
  catalog: CatalogState,
  documents: Snapshot<DocumentRecord[]> | null,
  comments: Snapshot<CommentsData> | null,
): Summary[] {
  const docMap = new Map<string, DocumentRecord[]>();
  const parentMap = new Map<string, CommentMessage[]>();
  const activity = new Map<string, { yard: string | null; dnv: string | null }>();
  for (const record of documents?.data ?? []) {
    if (!docMap.has(record.drawingNo)) docMap.set(record.drawingNo, []);
    docMap.get(record.drawingNo)!.push(record);
  }
  const parents = new Map(
    (comments?.data.messages ?? []).filter((m) => m.kind === 'parent').map((m) => [m.messageId, m]),
  );
  for (const m of comments?.data.messages ?? []) {
    const drawings = new Set(
      [
        ...m.links,
        ...(m.kind === 'reply' && m.parentId ? (parents.get(m.parentId)?.links ?? []) : []),
      ].map((l) => l.drawingNo),
    );
    for (const no of drawings) {
      if (m.kind === 'parent') {
        if (!parentMap.has(no)) parentMap.set(no, []);
        parentMap.get(no)!.push(m);
      }
      if (m.kind === 'reply' && m.lastActivity.iso) {
        const times = activity.get(no) ?? { yard: null, dnv: null };
        if (
          ['Yard Design', 'Yard Site'].includes(m.issuedByRole) &&
          (!times.yard || m.lastActivity.iso > times.yard)
        )
          times.yard = m.lastActivity.iso;
        if (
          ['Approval Expert', 'NB Surveyor'].includes(m.issuedByRole) &&
          (!times.dnv || m.lastActivity.iso > times.dnv)
        )
          times.dnv = m.lastActivity.iso;
        activity.set(no, times);
      }
    }
  }
  const followed = new Set(catalog.followed);
  const docMissing = new Set(documents?.missingFromLatest ?? []);
  const commentMissing = new Set(comments?.missingFromLatest ?? []);
  const missingDrawingLinks = new Set(comments?.missingLinks?.map((l) => l.drawingNo) ?? []);
  const missingMessageDrawings = new Set<string>();
  for (const m of comments?.data.messages ?? [])
    if (commentMissing.has(messageKey(m)))
      for (const l of m.links) missingMessageDrawings.add(l.drawingNo);
  return catalog.catalog.drawings.flatMap((drawing, index) => {
    if (!followed.has(drawing.drawingNo)) return [];
    const no = drawing.drawingNo;
    const history = docMap.get(no) ?? [];
    const current = currentDocument(history);
    const responses = history
      .filter((r) => r.received.iso)
      .sort((a, b) => b.received.iso!.localeCompare(a.received.iso!));
    const ps = parentMap.get(no) ?? [];
    const open = ps.filter((m) => m.status === 'Open');
    const roles: Record<string, number> = {};
    for (const p of open)
      roles[p.actionNeededBy || '未指定'] = (roles[p.actionNeededBy || '未指定'] ?? 0) + 1;
    const staleDocuments = history.some((r) => docMissing.has(documentKey(r)));
    const staleComments = missingMessageDrawings.has(no) || missingDrawingLinks.has(no);
    const notes = [
      !documents
        ? 'Documents未导入'
        : !history.length
          ? '未找到图纸卡'
          : !current
            ? '未找到有效送审日期'
            : '',
      !comments ? 'Comments未导入' : !isFull(comments.source) ? '意见范围未确认完整' : '',
      staleDocuments ? '本次缺失部分图纸记录，保留旧数据' : '',
      staleComments ? '本次缺失部分意见，保留旧数据' : '',
    ];
    if (
      documents?.issues.some((i) => i.code === 'older-result-retained' && i.key === no) ||
      comments?.issues.some(
        (i) => i.code === 'older-message-retained' && ps.some((p) => p.messageId === i.key),
      )
    )
      notes.push('本次含较旧记录，已保留较新数据');
    if (
      current?.openComments !== null &&
      current?.openComments !== undefined &&
      comments &&
      current.openComments !== open.length
    )
      notes.push('两份来源的Open数不同');
    const sentDates = history
      .filter((r) => r.sent.iso)
      .sort((a, b) => a.sent.iso!.localeCompare(b.sent.iso!));
    const receivedDates = [...responses].reverse();
    return [
      {
        ...drawing,
        ...catalog.overrides[no],
        sequence: index + 1,
        drawingNo: no,
        currentDocument: current,
        documentAvailability: !documents
          ? 'not-imported'
          : !history.length
            ? 'not-found'
            : !current
              ? 'no-valid-sent'
              : 'available',
        firstSent: sentDates[0]?.sent ?? null,
        firstReceived: receivedDates[0]?.received ?? null,
        uniqueParentCount: ps.length,
        openCount: open.length,
        closedCount: ps.filter((m) => m.status === 'Closed').length,
        otherCount: ps.filter((m) => !['Open', 'Closed'].includes(m.status)).length,
        openByRole: roles,
        candidateYardDesignCount: roles['Yard Design'] ?? 0,
        sourceDates: {
          documents: documents?.source.dataDate ?? null,
          comments: comments?.source.dataDate ?? null,
        },
        history,
        latestResponse: responses[0] ?? null,
        parents: ps,
        lastYardActivity: activity.get(no)?.yard ?? null,
        lastDnvActivity: activity.get(no)?.dnv ?? null,
        staleDocuments,
        staleComments,
        note: notes.filter(Boolean).join('；'),
      },
    ];
  });
}

const semanticDocs = (rows: DocumentRecord[]) =>
  JSON.stringify(
    rows
      .map(({ sources: _sources, ...r }) => r)
      .sort((a, b) => documentKey(a).localeCompare(documentKey(b))),
  );
const semanticComments = (data: CommentsData) =>
  JSON.stringify(
    data.messages
      .map(({ sources: _sources, superseded: _history, ...m }) => ({
        ...m,
        links: [...m.links].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }))
      .sort((a, b) => messageKey(a).localeCompare(messageKey(b))),
  );

export function applyImport(
  state: ToolState,
  prepared: PreparedImport,
  followed?: string[],
): ToolState {
  if (!state.project || !prepared.result.canSave) throw new Error('项目未确认或文件含阻断错误');
  const next = structuredClone(state);
  const kind = prepared.kind;
  if (kind !== 'catalog') {
    const previous = kind === 'documents' ? state.documents.at(-1) : state.comments.at(-1);
    if (
      previous?.source.dataDate &&
      prepared.source.dataDate &&
      prepared.source.dataDate < previous.source.dataDate
    )
      throw new Error(
        '资料日期早于当前保存版本，已阻止覆盖。请核对文件，或先撤销/恢复所需历史版本。',
      );
  }
  if (kind === 'catalog') {
    next.undo.catalog = { catalog: state.catalog, template: state.template };
    const catalog = prepared.result.data as import('./contracts').DrawingCatalogV1;
    const imported = new Map(catalog.drawings.map((d) => [d.drawingNo, d]));
    const retained =
      state.catalog?.catalog.drawings.filter((d) => !imported.has(d.drawingNo)) ?? [];
    next.catalog = {
      catalog: { ...catalog, drawings: [...catalog.drawings, ...retained] },
      overrides: state.catalog?.overrides ?? {},
      statistics: state.catalog?.statistics,
      followed:
        followed ?? catalog.drawings.filter((d) => d.dnvRequired === true).map((d) => d.drawingNo),
    };
    next.template = prepared.template ?? state.template;
  } else if (kind === 'documents') {
    const old = state.documents.at(-1);
    const fresh = prepared.result.data as DocumentRecord[];
    const keys = new Set(fresh.map(documentKey));
    const missing = old?.data.filter((r) => !keys.has(documentKey(r))) ?? [];
    const priorDocuments = new Map(old?.data.map((r) => [documentKey(r), r]) ?? []);
    const warnings: import('./contracts').Issue[] = [];
    const current = fresh.map((r) => {
      const previous = priorDocuments.get(documentKey(r));
      if (previous?.received.iso && (!r.received.iso || r.received.iso < previous.received.iso)) {
        warnings.push({
          code: 'older-result-retained',
          severity: 'warning',
          key: r.drawingNo,
          rows: r.sources.map((s) => s.row),
        });
        return previous;
      }
      return r;
    });
    const data = [...current, ...missing];
    const snapshot: Snapshot<DocumentRecord[]> = {
      snapshotId: crypto.randomUUID(),
      projectKey: state.project.projectKey,
      source: prepared.source,
      data,
      issues: [...prepared.result.issues, ...warnings],
      missingFromLatest: missing.map(documentKey),
    };
    next.undo.documents = { documents: state.documents };
    const identical =
      old &&
      semanticDocs(old.data) === semanticDocs(data) &&
      JSON.stringify(old.missingFromLatest) === JSON.stringify(snapshot.missingFromLatest);
    next.documents = identical
      ? [
          ...state.documents.slice(0, -1),
          { ...snapshot, snapshotId: old.snapshotId, lastImportUnchanged: true },
        ]
      : [...state.documents, snapshot].slice(-2);
  } else {
    const old = state.comments.at(-1);
    const fresh = prepared.result.data as CommentsData;
    const keys = new Set(fresh.messages.map(messageKey));
    const missing = old?.data.messages.filter((m) => !keys.has(messageKey(m))) ?? [];
    const priorMessages = new Map(old?.data.messages.map((m) => [messageKey(m), m]) ?? []);
    const warnings: import('./contracts').Issue[] = [];
    const missingLinks: Array<{ messageId: string; drawingNo: string; revision: string }> = [];
    const mergedFresh = fresh.messages.map((m) => {
      const previous = priorMessages.get(messageKey(m));
      if (!previous) return m;
      if (previous.lastActivity.iso && m.lastActivity.iso === previous.lastActivity.iso) {
        const content = (r: CommentMessage) =>
          JSON.stringify([
            r.kind,
            r.status,
            r.type,
            r.title,
            r.description,
            r.discipline,
            r.issuedByRole,
            r.actionNeededBy,
            r.sortOrder,
            r.issueDate.iso,
            r.closedDate.iso,
          ]);
        if (content(previous) !== content(m))
          throw new Error(`意见 ${m.messageId} 同一活动时间的内容冲突，已保留原数据`);
      }
      const current = new Set(m.links.map((l) => JSON.stringify(l)));
      const absent = previous.links.filter((l) => !current.has(JSON.stringify(l)));
      for (const l of absent) missingLinks.push({ messageId: m.messageId, ...l });
      if (
        previous.lastActivity.iso &&
        m.lastActivity.iso &&
        m.lastActivity.iso < previous.lastActivity.iso
      ) {
        warnings.push({
          code: 'older-message-retained',
          severity: 'warning',
          key: m.messageId,
          rows: m.sources.map((s) => s.row),
        });
        return { ...previous, links: [...m.links, ...absent] };
      }
      return { ...m, links: [...m.links, ...absent] };
    });
    const data = {
      messages: [...mergedFresh, ...missing],
      orphanMessageIds: fresh.orphanMessageIds,
    };
    const snapshot: Snapshot<CommentsData> = {
      snapshotId: crypto.randomUUID(),
      projectKey: state.project.projectKey,
      source: prepared.source,
      data,
      issues: [...prepared.result.issues, ...warnings],
      missingFromLatest: missing.map(messageKey),
      missingLinks,
    };
    next.undo.comments = { comments: state.comments };
    const identical =
      old &&
      semanticComments(old.data) === semanticComments(data) &&
      JSON.stringify(old.missingFromLatest) === JSON.stringify(snapshot.missingFromLatest) &&
      JSON.stringify(old.missingLinks ?? []) === JSON.stringify(missingLinks);
    next.comments = identical
      ? [
          ...state.comments.slice(0, -1),
          { ...snapshot, snapshotId: old.snapshotId, lastImportUnchanged: true },
        ]
      : [...state.comments, snapshot].slice(-2);
  }
  next.operations = [
    ...state.operations,
    { id: crypto.randomUUID(), kind, createdAt: new Date().toISOString() },
  ].slice(-30);
  return next;
}

export function undoImport(state: ToolState, kind: InputKind): ToolState {
  const prior = state.undo[kind];
  if (!prior) throw new Error('没有可撤销的导入');
  const next = structuredClone(state);
  if (kind === 'catalog') {
    next.catalog = prior.catalog ?? null;
    next.template = prior.template ?? null;
  }
  if (kind === 'documents') next.documents = prior.documents ?? [];
  if (kind === 'comments') next.comments = prior.comments ?? [];
  delete next.undo[kind];
  next.operations = next.operations.filter((o) => o.kind !== kind);
  return next;
}
