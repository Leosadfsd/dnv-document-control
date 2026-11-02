import type {
  CommentMessage,
  DateValue,
  DocumentRecord,
  Issue,
  ParseResult,
  SourceMeta,
} from './contracts';

export const drawingNo = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase();
export const headerKey = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\s\u00a0]+/g, '')
    .toLowerCase();
export const dnvRequired = (value: unknown): boolean | null => {
  const text = String(value ?? '').trim();
  return text === '√' ? true : text === '' ? false : null;
};
export const messageKind = (value: unknown): CommentMessage['kind'] => {
  const marker = String(value ?? '').trim();
  return marker === '' ? 'parent' : marker === 'Y' ? 'reply' : 'unknown';
};

export function dateValue(value: unknown): DateValue {
  if (value === null || value === undefined || value === '')
    return { raw: '', iso: null, issue: null };
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? { raw: String(value), iso: null, issue: 'invalid-date' }
      : { raw: value.toISOString(), iso: value.toISOString(), issue: null };
  const raw = String(value).trim();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 2958466) {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return { raw, iso: date.toISOString(), issue: null };
  }
  // Explicit calendar dates avoid locale-dependent parsing and impossible-date rollover.
  const match =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z)?)?$/.exec(
      raw,
    );
  if (!match) return { raw, iso: null, issue: 'invalid-date' };
  const [, y, m, d, h = '00', min = '00', sec = '00', ms = '0'] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec, Math.round(Number(ms) * 1000)));
  if (
    date.getUTCFullYear() !== +y ||
    date.getUTCMonth() !== +m - 1 ||
    date.getUTCDate() !== +d ||
    +h > 23 ||
    +min > 59 ||
    +sec > 59
  ) {
    return { raw, iso: null, issue: 'invalid-date' };
  }
  return { raw, iso: date.toISOString(), issue: null };
}

export function parentIdFor(
  messageId: string,
  kind: CommentMessage['kind'],
  parentIds: Set<string>,
): string | null {
  if (kind === 'parent') return messageId;
  if (kind !== 'reply') return null;
  const matches = [...parentIds].filter((id) => messageId.startsWith(`${id}_`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function currentDocument(records: DocumentRecord[]): DocumentRecord | null {
  return (
    records
      .filter((r) => r.sent.iso)
      .sort(
        (a, b) =>
          b.sent.iso!.localeCompare(a.sent.iso!) ||
          (b.received.iso ?? '').localeCompare(a.received.iso ?? ''),
      )[0] ?? null
  );
}

const commentContent = (r: CommentMessage) =>
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
    r.issueDate.iso ?? r.issueDate.raw,
    r.closedDate.iso ?? r.closedDate.raw,
  ]);
const unique = <T>(values: T[], key: (v: T) => string): T[] => [
  ...new Map(values.map((v) => [key(v), v])).values(),
];

export function mergeMessages(records: CommentMessage[]): ParseResult<CommentMessage[]> {
  const groups = new Map<string, CommentMessage[]>();
  const issues: Issue[] = [];
  for (const row of records) {
    const key = JSON.stringify([row.projectId, row.messageId]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const data: CommentMessage[] = [];
  for (const [key, rows] of groups) {
    const ordered = [...rows].sort((a, b) =>
      (b.lastActivity.iso ?? '').localeCompare(a.lastActivity.iso ?? ''),
    );
    const latest = ordered[0];
    const conflicts = ordered.filter((r) => commentContent(r) !== commentContent(latest));
    if (
      conflicts.some(
        (r) =>
          !r.lastActivity.iso ||
          !latest.lastActivity.iso ||
          r.lastActivity.iso === latest.lastActivity.iso,
      )
    ) {
      issues.push({
        code: 'message-conflict',
        severity: 'blocking',
        key,
        rows: rows.flatMap((r) => r.sources.map((s) => s.row)),
      });
    }
    data.push({
      ...latest,
      links: unique(
        rows.flatMap((r) => r.links),
        (l) => JSON.stringify([l.drawingNo, l.revision]),
      ),
      sources: unique(
        rows.flatMap((r) => r.sources),
        (s) => JSON.stringify([s.sourceFingerprint, s.row]),
      ),
      superseded: conflicts.map(({ superseded: _history, ...record }) => record),
    });
  }
  const parentsByProject = new Map<string, Set<string>>();
  for (const row of data)
    if (row.kind === 'parent') {
      if (!parentsByProject.has(row.projectId)) parentsByProject.set(row.projectId, new Set());
      parentsByProject.get(row.projectId)!.add(row.messageId);
    }
  for (const record of data) {
    const ids = parentsByProject.get(record.projectId) ?? new Set<string>();
    const prefix = record.messageId.split('_')[0];
    record.parentId =
      record.kind === 'parent'
        ? record.messageId
        : record.kind === 'reply' && ids.has(prefix)
          ? prefix
          : parentIdFor(record.messageId, record.kind, ids);
    if (record.kind === 'unknown' || !record.parentId)
      issues.push({
        code: record.kind === 'unknown' ? 'unknown-reply-marker' : 'orphan-reply',
        severity: 'warning',
        rows: record.sources.map((s) => s.row),
        key: record.messageId,
      });
  }
  return { data, issues, canSave: !issues.some((i) => i.severity === 'blocking') };
}

export function mergeDocuments(records: DocumentRecord[]): ParseResult<DocumentRecord[]> {
  const groups = new Map<string, DocumentRecord[]>();
  for (const row of records) {
    const key = JSON.stringify([
      row.projectKey,
      row.drawingNo,
      row.revision,
      row.sent.iso ?? row.sent.raw,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const data: DocumentRecord[] = [];
  const issues: Issue[] = [];
  for (const [key, rows] of groups) {
    const content = (r: DocumentRecord) =>
      JSON.stringify([
        r.title,
        r.status,
        r.approvalStatus,
        r.received.iso ?? r.received.raw,
        r.openComments,
      ]);
    if (new Set(rows.map(content)).size > 1)
      issues.push({
        code: 'document-conflict',
        severity: 'blocking',
        key,
        rows: rows.flatMap((r) => r.sources.map((s) => s.row)),
      });
    data.push({ ...rows[0], sources: rows.flatMap((r) => r.sources) });
  }
  return { data, issues, canSave: !issues.some((i) => i.severity === 'blocking') };
}

export function threadOrder(messages: CommentMessage[]): CommentMessage[] {
  return [...messages].sort((a, b) => {
    if (a.sortOrder !== null && b.sortOrder !== null)
      return a.sortOrder - b.sortOrder || a.sources[0].row - b.sources[0].row;
    if (a.sortOrder !== null) return -1;
    if (b.sortOrder !== null) return 1;
    return (
      (a.lastActivity.iso ?? '').localeCompare(b.lastActivity.iso ?? '') ||
      a.sources[0].row - b.sources[0].row
    );
  });
}

export function parentCounts(messages: CommentMessage[], no: string) {
  const parents = messages.filter(
    (r) => r.kind === 'parent' && r.links.some((l) => l.drawingNo === no),
  );
  const open = parents.filter((r) => r.status === 'Open');
  return {
    total: parents.length,
    open: open.length,
    closed: parents.filter((r) => r.status === 'Closed').length,
    other: parents.filter((r) => r.status !== 'Closed' && r.status !== 'Open').length,
    candidateYardDesign: open.filter((r) => r.actionNeededBy === 'Yard Design').length,
  };
}

export function canCompareComplete(a: SourceMeta, b: SourceMeta): boolean {
  const complete = (s: SourceMeta) =>
    s.scope.confirmedByUser &&
    s.scope.project === 'all' &&
    s.scope.revisions === 'all' &&
    (s.kind !== 'comments' || s.scope.statuses === 'all');
  return (
    a.kind === b.kind &&
    complete(a) &&
    complete(b) &&
    JSON.stringify(a.scope) === JSON.stringify(b.scope)
  );
}

export function validateProjectIds(expected: string, found: string[]): Issue[] {
  return found.every((id) => id === expected) && found.length > 0
    ? []
    : [{ code: 'project-mismatch', severity: 'blocking', rows: [] }];
}

export function validateCatalog(
  catalog: unknown,
): ParseResult<import('./contracts').DrawingCatalogV1 | null> {
  const issues: Issue[] = [];
  const value = catalog as import('./contracts').DrawingCatalogV1;
  const exactKeys = (obj: object, keys: string[]) =>
    Object.keys(obj).every((k) => keys.includes(k));
  if (
    !value ||
    typeof value !== 'object' ||
    value.format !== 'drawing-catalog' ||
    value.schemaVersion !== 1 ||
    typeof value.projectKey !== 'string' ||
    !value.projectKey.trim() ||
    !value.source ||
    !Array.isArray(value.drawings) ||
    !exactKeys(value, ['format', 'schemaVersion', 'projectKey', 'source', 'drawings']) ||
    typeof value.source.filename !== 'string' ||
    typeof value.source.importedAt !== 'string' ||
    !(value.source.dataDate === null || typeof value.source.dataDate === 'string') ||
    !exactKeys(value.source, ['filename', 'importedAt', 'dataDate'])
  ) {
    return {
      data: null,
      issues: [{ code: 'invalid-catalog', severity: 'blocking', rows: [] }],
      canSave: false,
    };
  }
  const seen = new Set<string>();
  value.drawings.forEach((r, index) => {
    if (
      !r ||
      r.type !== 'detail' ||
      typeof r.drawingNo !== 'string' ||
      !r.drawingNo ||
      r.drawingNo !== drawingNo(r.drawingNo) ||
      !exactKeys(r, ['drawingNo', 'type', 'cn', 'en', 'owner', 'department', 'dnvRequired']) ||
      !['cn', 'en', 'owner', 'department'].every(
        (k) => typeof r[k as keyof typeof r] === 'string',
      ) ||
      ![true, false, null].includes(r.dnvRequired)
    ) {
      issues.push({ code: 'invalid-drawing', severity: 'blocking', rows: [index + 1] });
    } else if (seen.has(r.drawingNo))
      issues.push({
        code: 'duplicate-drawing',
        severity: 'blocking',
        rows: [index + 1],
        key: r.drawingNo,
      });
    seen.add(r?.drawingNo);
  });
  return { data: value, issues, canSave: !issues.length };
}
