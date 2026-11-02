import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { prepareWorkbook, parseComments } from '../src/domain/parse';
import {
  applyImport,
  buildDrawingSummaries,
  compareComments,
  undoImport,
} from '../src/domain/derive';
import { emptyState } from '../src/domain/model';
import { validateBackup, exportBackup } from '../src/data/storage';
import { parseLetterItems, letterFilename } from '../src/domain/letter';
import type { SourceMeta, ImportContext, CommentsData } from '../src/domain/contracts';

const project = { projectKey: 'test', projectId: '42', name: 'Synthetic' };
const source = (kind: SourceMeta['kind']): SourceMeta => ({
  kind,
  filename: 'synthetic.xlsx',
  fingerprint: 'a',
  importedAt: '2026-10-14T00:00:00Z',
  dataDate: null,
  scope: { confirmedByUser: true, project: 'all', revisions: 'all', statuses: 'all' },
});
const context = (kind: SourceMeta['kind']): ImportContext => ({ project, source: source(kind) });
const workbook = (grid: unknown[][], date1904 = false) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Synthetic');
  wb.Workbook = { WBProps: { date1904 } };
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
};
const ledger = () =>
  prepareWorkbook(
    workbook([
      ['系统\n负责人', 'Drawing Name\n图名', 'DNV\n船检', 'Drawing\n Number\n图号'],
      ['Synthetic owner', 'Synthetic title\n合成图纸', '√', 'K000001'],
    ]),
    'catalog',
    context('catalog'),
  );
const parentRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  __row: 2,
  'Project Id': '42',
  CommentId: id,
  'Is Reply': '',
  'Id Sort Order': '100',
  Status: 'Open',
  Type: 'Action Required',
  Title: 'Synthetic',
  Description: 'Synthetic content',
  'Issued By Role': 'Approval Expert',
  'Action Needed By': 'Yard Design',
  'Issue Date': '2026-01-01',
  'Last Activity': '2026-01-01',
  'Closed Date': '',
  'Document no': 'K000001',
  'Document rev': '0',
  ...overrides,
});
test('moved ledger headers and original template are parsed without proofreader ownership', () => {
  const p = ledger();
  assert.equal(p.result.canSave, true);
  assert.equal(
    (p.result.data as { drawings: { owner: string }[] }).drawings[0].owner,
    'Synthetic owner',
  );
  assert.ok(p.template?.base64);
  assert.equal(p.template?.rows.K000001, 2);
});
test('1904 workbook dates respect workbook setting', () => {
  const p = prepareWorkbook(
    workbook(
      [
        [
          'Document No.',
          'Document Title',
          'Revision',
          'Sent Date',
          'Status',
          'Approval Status',
          'Received Date',
          'Open comments',
        ],
        ['K000001', 'Synthetic', '0', 1, 'Sent', '', '', 0],
      ],
      true,
    ),
    'documents',
    context('documents'),
  );
  assert.equal(
    (p.result.data as { sent: { iso: string } }[])[0].sent.iso,
    '1904-01-02T00:00:00.000Z',
  );
});
test('latest submission awaiting result and historical result remain different fields', () => {
  const state = applyImport({ ...emptyState(), project }, ledger());
  const p = prepareWorkbook(
    workbook([
      [
        'Document No.',
        'Document Title',
        'Revision',
        'Sent Date',
        'Status',
        'Approval Status',
        'Received Date',
        'Open comments',
      ],
      ['K000001', 'Synthetic', '0', '2026-01-01', 'Received', 'AC', '2026-01-02', 1],
      ['K000001', 'Synthetic', '1', '2026-02-01', 'Sent', '', '', 0],
    ]),
    'documents',
    context('documents'),
  );
  const next = applyImport(state, p);
  const s = buildDrawingSummaries(next.catalog!, next.documents[0], null)[0];
  assert.equal(s.currentDocument?.revision, '1');
  assert.equal(s.currentDocument?.approvalStatus, '');
  assert.equal(s.latestResponse?.revision, '0');
});
test('partial missing comments retained; repeated content does not add snapshots or changes; undo scoped', () => {
  const base = applyImport({ ...emptyState(), project }, ledger());
  const parsed = parseComments([parentRow('D42-1'), parentRow('D42-2')], context('comments'));
  const p = { kind: 'comments' as const, source: source('comments'), result: parsed, rawRows: 2 };
  const first = applyImport(base, p),
    repeated = applyImport(first, p);
  assert.equal(repeated.comments.length, 1);
  assert.equal(compareComments(null, repeated.comments[0]).changes.length, 0);
  const partial = applyImport(first, {
    ...p,
    result: parseComments([parentRow('D42-1')], context('comments')),
  });
  assert.equal(partial.comments.at(-1)!.data.messages.length, 2);
  assert.equal(partial.comments.at(-1)!.missingFromLatest.length, 1);
  const undone = undoImport(partial, 'comments');
  assert.equal(undone.comments.length, 1);
  assert.ok(undone.template);
});
test('Closed status without closed date is still counted; replies do not add parents', () => {
  const base = applyImport({ ...emptyState(), project }, ledger());
  const data = parseComments(
    [
      parentRow('D42-1', { Status: 'Closed', 'Closed Date': '' }),
      parentRow('D42-1_1', {
        'Is Reply': 'Y',
        'Issued By Role': 'Yard Design',
        'Id Sort Order': '101',
      }),
    ],
    context('comments'),
  );
  const state = applyImport(base, {
    kind: 'comments',
    source: source('comments'),
    result: data,
    rawRows: 2,
  });
  const s = buildDrawingSummaries(state.catalog!, null, state.comments[0])[0];
  assert.equal(s.uniqueParentCount, 1);
  assert.equal(s.closedCount, 1);
  assert.ok(s.lastYardActivity);
});
test('partial import keeps prior cross-drawing and revision links', () => {
  const base = applyImport({ ...emptyState(), project }, ledger());
  const sourceRows = [
    parentRow('D42-1'),
    parentRow('D42-1', { 'Document no': 'K000002', 'Document rev': '1' }),
  ];
  const p = {
    kind: 'comments' as const,
    source: source('comments'),
    result: parseComments(sourceRows, context('comments')),
    rawRows: 2,
  };
  const first = applyImport(base, p),
    partial = applyImport(first, {
      ...p,
      result: parseComments([sourceRows[0]], context('comments')),
    });
  assert.equal(partial.comments.at(-1)!.data.messages[0].links.length, 2);
  assert.equal(partial.comments.at(-1)!.missingLinks?.length, 1);
  assert.ok(
    compareComments(first.comments[0], partial.comments.at(-1)!).changes.some(
      (c) => c.kind === 'not-found',
    ),
  );
});
test('older source dates cannot overwrite and same-time message conflicts block', () => {
  const base = applyImport({ ...emptyState(), project }, ledger());
  const p = {
    kind: 'comments' as const,
    source: { ...source('comments'), dataDate: '2026-02-01' },
    result: parseComments([parentRow('D42-1')], context('comments')),
    rawRows: 1,
  };
  const first = applyImport(base, p);
  assert.throws(
    () => applyImport(first, { ...p, source: { ...p.source, dataDate: '2026-01-01' } }),
    /早于/,
  );
  assert.throws(
    () =>
      applyImport(first, {
        ...p,
        result: parseComments(
          [parentRow('D42-1', { Description: 'Conflicting synthetic' })],
          context('comments'),
        ),
      }),
    /冲突/,
  );
});
test('invalid backup rejected before persistence; template and identity survive restore', () => {
  const state = applyImport({ ...emptyState(), project }, ledger());
  const restored = validateBackup(exportBackup(state));
  assert.equal(restored.template?.base64, state.template?.base64);
  assert.ok(restored.undo.catalog);
  const bad = JSON.parse(exportBackup(state));
  bad.catalog.followed = ['K-NOT-FOUND'];
  assert.throws(() => validateBackup(JSON.stringify(bad)));
  assert.throws(() => validateBackup('{"format":"owner-backup","schemaVersion":1}'));
});
test('oversized files are rejected before parser and 5k document rows parse', () => {
  assert.throws(
    () => prepareWorkbook(new ArrayBuffer(20 * 1024 * 1024 + 1), 'documents', context('documents')),
    /20 MB/,
  );
  const headers = [
    'Document No.',
    'Document Title',
    'Revision',
    'Sent Date',
    'Status',
    'Approval Status',
    'Received Date',
    'Open comments',
  ];
  const rows = Array.from({ length: 5000 }, (_, i) => [
    `K${String(i).padStart(6, '0')}`,
    'Synthetic',
    '0',
    '2026-01-01',
    'Received',
    'AC',
    '2026-01-02',
    0,
  ]);
  const result = prepareWorkbook(workbook([headers, ...rows]), 'documents', context('documents'));
  assert.equal(result.result.canSave, true);
  assert.equal((result.result.data as unknown[]).length, 5000);
});
test('empty source is blocking and bad restore message types fail validation', () => {
  assert.equal(parseComments([], context('comments')).canSave, false);
  const base = applyImport({ ...emptyState(), project }, ledger());
  const imported = applyImport(base, {
    kind: 'comments',
    source: source('comments'),
    result: parseComments([parentRow('D42-1')], context('comments')),
    rawRows: 1,
  });
  const corrupt = JSON.parse(exportBackup(imported));
  corrupt.comments[0].data.messages[0].description = { bad: true };
  assert.throws(() => validateBackup(JSON.stringify(corrupt)));
});
test('letter extracts approval table only, not numbers referenced in body', () => {
  const line = (y: number, cells: [string, number][]) =>
    cells.map(([text, x]) => ({ text, x, y, width: 30, page: 1 }));
  const items = [
    ...line(700, [['D42-J-123', 10]]),
    ...line(600, [
      ['Document No', 10],
      ['Rev', 110],
      ['Title', 200],
      ['Code', 400],
      ['Status', 450],
    ]),
    ...line(580, [
      ['K000001', 10],
      ['Synthetic', 200],
    ]),
    ...line(560, [
      ['K000002', 10],
      ['Synthetic2', 200],
    ]),
    ...line(500, [['Document No. K000001/0', 10]]),
    ...line(450, [['Please refer to K000003', 10]]),
  ];
  const p = parseLetterItems(items);
  assert.equal(p.letterNo, '123');
  assert.deepEqual(
    p.candidates.map((c) => c.drawingNo),
    ['K000001', 'K000002'],
  );
  assert.equal(
    letterFilename('123', { ...p.candidates[0], cn: '合成图纸', owner: '合成负责人' }, 0),
    'Approval Letter NB 123_1_K000001_合成图纸_合成负责人.pdf',
  );
});
test('20k comment rows retain 5k parents and 15k replies under stress', () => {
  const rows = [];
  for (let i = 0; i < 5000; i++) {
    rows.push(
      parentRow(`D42-${i}`, {
        'Id Sort Order': String(i * 100),
        'Document no': `K${String(i).padStart(6, '0')}`,
      }),
    );
    for (let j = 1; j <= 3; j++)
      rows.push(
        parentRow(`D42-${i}_${j}`, {
          'Is Reply': 'Y',
          'Id Sort Order': String(i * 100 + j),
          'Document no': `K${String(i).padStart(6, '0')}`,
        }),
      );
  }
  const t = performance.now();
  const result = parseComments(rows, context('comments'));
  assert.equal(result.canSave, true);
  assert.equal(result.data.messages.filter((m) => m.kind === 'parent').length, 5000);
  assert.equal(result.data.messages.length, 20000);
  console.log(`20k rows parse: ${Math.round(performance.now() - t)} ms (Node only)`);
});
