import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawingNo,
  dnvRequired,
  dateValue,
  currentDocument,
  messageKind,
  mergeDocuments,
  mergeMessages,
  threadOrder,
  parentCounts,
  canCompareComplete,
  validateCatalog,
  validateProjectIds,
} from '../src/domain/rules';
import type { CommentMessage, DocumentRecord, SourceMeta } from '../src/domain/contracts';

function message(override: Partial<CommentMessage> = {}): CommentMessage {
  return {
    projectId: '42',
    messageId: 'D42-1',
    parentId: null,
    kind: 'parent',
    sortOrder: 100,
    status: 'Open',
    type: 'Comment',
    title: 'Synthetic question',
    description: 'Synthetic content',
    discipline: 'E',
    issuedByRole: 'Approval Expert',
    actionNeededBy: 'Yard Design',
    issueDate: dateValue('2026-01-01'),
    lastActivity: dateValue('2026-01-01'),
    closedDate: dateValue(null),
    links: [{ drawingNo: 'K0001', revision: '0' }],
    sources: [{ row: 2, sourceFingerprint: 'synthetic' }],
    superseded: [],
    ...override,
  };
}
function doc(override: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    projectKey: 'synthetic',
    drawingNo: 'K0001',
    title: 'Synthetic document',
    revision: 'RF',
    status: 'Received',
    approvalStatus: 'FI',
    sent: dateValue('2026-01-01'),
    received: dateValue('2026-01-02'),
    openComments: 1,
    sources: [{ row: 2, sourceFingerprint: 'synthetic' }],
    ...override,
  };
}
const scope: SourceMeta = {
  kind: 'comments',
  filename: 'synthetic-withallrevisions.xlsx',
  fingerprint: 'f',
  importedAt: '2026-01-01T00:00:00Z',
  dataDate: null,
  scope: { project: 'all', revisions: 'all', statuses: 'all', confirmedByUser: true },
};

test('identity preserves zeros/hyphens; only explicit check mark is required', () => {
  assert.equal(drawingNo('  k-0001 '), 'K-0001');
  assert.equal(dnvRequired('√'), true);
  assert.equal(dnvRequired(null), false);
  for (const v of ['Y', 'v', '是', '1']) assert.equal(dnvRequired(v), null);
  assert.equal(messageKind('Y'), 'reply');
  assert.equal(messageKind('b'), 'unknown');
});
test('calendar rejects rollover and ambiguous dates, preserving original text', () => {
  assert.equal(dateValue('2026-02-30').issue, 'invalid-date');
  assert.equal(dateValue('09/10/26').iso, null);
  assert.equal(dateValue('2026.9.8').iso, '2026-09-08T00:00:00.000Z');
  assert.equal(dateValue(25569).iso, '1970-01-01T00:00:00.000Z');
  assert.equal(dateValue('invalid').raw, 'invalid');
});
test('latest submission wins over revision text and latest receipt breaks submission tie', () => {
  const later = doc({ revision: '0', sent: dateValue('2026-02-01') });
  assert.equal(currentDocument([doc(), later])?.revision, '0');
  const tie = doc({ sent: later.sent, received: dateValue('2026-03-01') });
  assert.equal(currentDocument([later, tie])?.received.iso, tie.received.iso);
  assert.equal(currentDocument([doc({ sent: dateValue(null) })]), null);
});
test('duplicate document merges source rows; conflicting same identity blocks save', () => {
  assert.equal(mergeDocuments([doc(), doc()]).data.length, 1);
  assert.equal(mergeDocuments([doc(), doc({ approvalStatus: 'AC' })]).canSave, false);
});
test('cross-drawing/revision associations survive one message identity', () => {
  const merged = mergeMessages([
    message(),
    message({ links: [{ drawingNo: 'K0002', revision: '1' }] }),
    message({ links: [{ drawingNo: 'K0001', revision: '1' }] }),
    message({ messageId: 'D42-1_2', kind: 'reply', sortOrder: 102 }),
    message({ messageId: 'D42-1_1', kind: 'reply', sortOrder: 101 }),
  ]);
  assert.equal(merged.canSave, true);
  assert.equal(merged.data.length, 3);
  assert.equal(merged.data[0].links.length, 3);
  assert.equal(merged.data[1].parentId, 'D42-1');
  assert.equal(parentCounts(merged.data, 'K0001').total, 1);
  assert.equal(parentCounts(merged.data, 'K0002').total, 1);
  assert.deepEqual(
    threadOrder(merged.data).map((r) => r.messageId),
    ['D42-1', 'D42-1_1', 'D42-1_2'],
  );
});
test('newer conflicting record wins with provenance; equal-time conflict blocks', () => {
  const newest = message({
    description: 'Updated synthetic',
    lastActivity: dateValue('2026-01-03'),
  });
  const result = mergeMessages([message(), newest]);
  assert.equal(result.canSave, true);
  assert.equal(result.data[0].description, newest.description);
  assert.equal(result.data[0].superseded.length, 1);
  assert.equal(mergeMessages([message(), message({ status: 'Closed' })]).canSave, false);
});
test('orphan/unknown marker remains visible and is not invented as parent', () => {
  const result = mergeMessages([
    message({ messageId: 'D42-99_1', kind: 'reply' }),
    message({ messageId: 'D42-88', kind: 'unknown' }),
  ]);
  assert.equal(result.data.length, 2);
  assert.equal(result.issues.length, 2);
  assert.equal(parentCounts(result.data, 'K0001').total, 0);
});
test('project boundaries prevent another project reply attaching to existing parent', () => {
  const result = mergeMessages([
    message(),
    message({ projectId: '43', messageId: 'D42-1_1', kind: 'reply' }),
  ]);
  assert.equal(result.data[1].parentId, null);
});
test('mixed or wrong projects block import; absent identity is not inferred from filename', () => {
  assert.equal(validateProjectIds('42', ['42', '42']).length, 0);
  assert.equal(validateProjectIds('42', ['42', '43'])[0].severity, 'blocking');
  assert.equal(validateProjectIds('42', [])[0].code, 'project-mismatch');
});
test('unknown approval/status/role values are retained, not mapped to closed', () => {
  const d = mergeDocuments([doc({ approvalStatus: 'NEW-CODE' })]);
  assert.equal(d.data[0].approvalStatus, 'NEW-CODE');
  const c = mergeMessages([message({ status: 'NEW-STATE', actionNeededBy: 'New Role' })]);
  assert.equal(c.data[0].actionNeededBy, 'New Role');
  assert.equal(parentCounts(c.data, 'K0001').other, 1);
});
test('Open follow-up remains a candidate, not an assertion of technical action', () => {
  const result = mergeMessages([
    message(),
    message({
      messageId: 'D42-1_1',
      kind: 'reply',
      description: 'Synthetic acknowledgement only',
      issuedByRole: 'Yard Design',
    }),
  ]);
  assert.deepEqual(parentCounts(result.data, 'K0001'), {
    total: 1,
    open: 1,
    closed: 0,
    other: 0,
    candidateYardDesign: 1,
  });
  assert.equal(
    parentCounts(mergeMessages([message({ status: 'Closed' })]).data, 'K0001').candidateYardDesign,
    0,
  );
  assert.equal(
    parentCounts(mergeMessages([message({ actionNeededBy: 'NB Surveyor' })]).data, 'K0001')
      .candidateYardDesign,
    0,
  );
});
test('all-revisions name alone is insufficient; complete comparisons require confirmation', () => {
  assert.equal(canCompareComplete(scope, scope), true);
  assert.equal(
    canCompareComplete(scope, { ...scope, scope: { ...scope.scope, statuses: 'open-only' } }),
    false,
  );
  assert.equal(
    canCompareComplete(scope, { ...scope, scope: { ...scope.scope, confirmedByUser: false } }),
    false,
  );
});
test('catalog interface roundtrip is state-free and duplicates block', () => {
  const catalog = {
    format: 'drawing-catalog',
    schemaVersion: 1,
    projectKey: 'synthetic',
    source: { filename: 'synthetic', importedAt: '2026-01-01', dataDate: null },
    drawings: [
      {
        drawingNo: 'K0001',
        type: 'detail',
        cn: '',
        en: 'Synthetic',
        owner: 'Synthetic',
        department: 'E',
        dnvRequired: true,
      },
    ],
  };
  assert.equal(validateCatalog(JSON.parse(JSON.stringify(catalog))).canSave, true);
  assert.equal(
    validateCatalog({ ...catalog, ownerStatus: 'Synthetic forbidden status' }).canSave,
    false,
  );
  assert.equal(
    validateCatalog({ ...catalog, drawings: [...catalog.drawings, ...catalog.drawings] }).canSave,
    false,
  );
});
