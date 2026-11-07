import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { parseCatalog, parseComments } from '../src/domain/parse';
import { buildOpenCommentCases } from '../src/domain/open-cases';
import {
  exportOpenCases,
  exportDrawingReplies,
  exportDrawingReplyPackage,
  exportDrawingGroups,
  wrapExportText,
} from '../src/data/opinion-export';
import type {
  ImportContext,
  Rows,
  Snapshot,
  CommentsData,
  CatalogState,
} from '../src/domain/contracts';
const context: ImportContext = {
  project: { projectKey: 'synthetic', projectId: '999999', name: 'Synthetic' },
  source: {
    kind: 'comments',
    filename: 'synthetic-comments.xlsx',
    fingerprint: 'synthetic',
    importedAt: '2026-11-07T00:00:00Z',
    dataDate: null,
    scope: { project: 'all', revisions: 'all', statuses: 'all', confirmedByUser: true },
  },
};
const row = (
  id: string,
  order: number,
  role = 'Approval Expert',
  reply = false,
  action = 'Yard Design',
  no = 'TEST-001',
  status = 'Open',
) => ({
  __row: order + 2,
  'Project Id': '999999',
  CommentId: id,
  'Id Sort Order': order,
  'Is Reply': reply ? 'Y' : '',
  Status: status,
  Type: 'Action Required',
  Title: 'Synthetic title',
  Description: `Body for ${id}`,
  'Issued By Role': role,
  'Action Needed By': action,
  'Issue Date': '2026-10-01',
  'Last Activity': '2026-10-02',
  'Closed Date': '',
  'Document no': no,
  'Document rev': 'R0',
});
function fixture(rows: Rows) {
  const result = parseComments(rows, context);
  assert.equal(result.canSave, true);
  const comments: Snapshot<CommentsData> = {
    snapshotId: 'test',
    projectKey: 'synthetic',
    source: context.source,
    data: result.data,
    issues: result.issues,
    missingFromLatest: [],
  };
  return comments;
}
function catalog(): CatalogState {
  const result = parseCatalog(
    [
      { 'Drawing Number': 'TEST-002', 'Drawing Name': '第二图', 系统负责人: '乙', DNV: '' },
      { 'Drawing Number': 'TEST-001', 'Drawing Name': '第一图', 系统负责人: '甲', DNV: '√' },
    ],
    { ...context, source: { ...context.source, kind: 'catalog' } },
  );
  return { catalog: result.data, followed: ['TEST-001'], overrides: {} };
}
const exportContext = {
  projectName: '合成验收项目',
  projectId: '999999',
  sourceFilename: 'synthetic-comments.xlsx',
  sourceDate: null,
  sourceComplete: true,
  exportedAt: '2026-11-07 10:00',
};

test('latest round retains consecutive messages from each side; parent is not invented as a DNV follow-up', () => {
  const comments = fixture([
    row('D999999-1', 1),
    row('D999999-1_1', 2, 'Yard Design', true),
    row('D999999-1_2', 3, 'Yard Design', true),
    row('D999999-1_3', 4, 'Approval Expert', true),
    row('D999999-1_4', 5, 'NB Surveyor', true),
  ]);
  const c = buildOpenCommentCases({ catalog: catalog(), comments })[0];
  assert.equal(c.latestYardRound.length, 2);
  assert.equal(c.latestDnvRound.length, 2);
  assert.equal(c.thread.length, 5);
  assert.equal(c.party, 'design'); // last author alone must not override parent responsibility
  assert.equal(
    buildOpenCommentCases({ catalog: null, comments: fixture([row('D999999-2', 1)]) })[0]
      .latestDnvRound.length,
    0,
  );
});
test('parents are unique across drawing links and scope uses all catalog drawings independent of followed membership', () => {
  const c = buildOpenCommentCases({
    catalog: catalog(),
    comments: fixture([
      row('D999999-1', 1),
      row('D999999-1', 1, 'Approval Expert', false, 'Yard Design', 'TEST-002'),
    ]),
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].drawings.length, 2);
  assert.equal(c[0].drawings[0].drawingNo, 'TEST-002');
  assert.equal(c[0].inCatalog, true);
  assert.equal(exportDrawingGroups(c).length, 2);
});
test('Closed/NA parents are excluded; explicit roles map separately; unknown roles remain pending', () => {
  const roles = ['Yard Design', 'Yard Site', 'Approval Expert', 'NB Surveyor', 'Unknown'];
  const comments = fixture([
    ...roles.map((r, i) => row(`D999999-${i + 1}`, i + 1, 'Approval Expert', false, r)),
    row('D999999-8', 8, 'Approval Expert', false, 'None', 'TEST-001', 'Closed'),
    row('D999999-9', 9, 'Approval Expert', false, 'None', 'TEST-001', 'NA'),
  ]);
  assert.deepEqual(
    buildOpenCommentCases({ catalog: null, comments }).map((c) => c.party),
    ['design', 'site', 'dnv', 'dnv', 'confirm'],
  );
});
test('missing parent/reply/link forces pending; partial scope and unreliable ordering remain visible without deleting history', () => {
  const comments = fixture([row('D999999-1', 1), row('D999999-1_1', 2, 'Yard Design', true)]);
  comments.missingFromLatest = ['["999999","D999999-1_1"]'];
  assert.equal(buildOpenCommentCases({ catalog: null, comments })[0].party, 'confirm');
  comments.missingFromLatest = [];
  comments.source = {
    ...comments.source,
    scope: { ...comments.source.scope, statuses: 'open-only' },
  };
  comments.data.messages[1].sortOrder = null;
  const c = buildOpenCommentCases({ catalog: null, comments })[0];
  assert.equal(c.orderReliable, false);
  assert.ok(c.warnings.some((w) => w.includes('范围')));
  assert.equal(c.thread.length, 2);
});
test('unmatched and unlinked cases survive; blank author, dates and owners do not crash export', () => {
  const comments = fixture([
    row('D999999-1', 1, '', false, '', 'NOT-IN-LEDGER'),
    row('D999999-2', 2, '', false, '', ''),
  ]);
  const cases = buildOpenCommentCases({ catalog: catalog(), comments });
  assert.equal(cases.length, 2);
  assert.ok(cases.every((c) => !c.inCatalog));
  const files = unzipSync(exportDrawingReplyPackage(cases, exportContext));
  assert.ok(files['待匹配图纸的意见.xlsx']);
  assert.ok(files['导出说明.txt']);
});
test('summary keeps long content in a single tall merged cell without loss or continuation fragments', () => {
  const text = 'Long content 中文长段落 =SUM(A1)\n'.repeat(150) + 'KEEP_END';
  const comments = fixture([
    { ...row('D999999-1', 1), Description: text },
    row('D999999-2', 2, 'Approval Expert', false, 'Yard Design', 'TEST-002'),
  ]);
  const cases = buildOpenCommentCases({ catalog: catalog(), comments });
  const bytes = exportOpenCases(cases, exportContext),
    files = unzipSync(bytes);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('KEEP_END'));
  assert.ok(!sheet.includes('（续）'));
  assert.ok(!sheet.includes('autoFilter'));
  assert.ok(sheet.includes('mergeCell ref="D7:D'));
  assert.ok(sheet.includes('state="frozen"'));
  assert.ok(sheet.includes('orientation="landscape"'));
  assert.ok(!sheet.includes('<f>'));
  assert.ok(strFromU8(files['xl/workbook.xml']).includes('_xlnm.Print_Titles'));
  const heights = [...sheet.matchAll(/ ht="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...heights) < 409);
  const wb = XLSX.read(bytes, { type: 'array' });
  assert.equal(wb.SheetNames[0], '未闭环清单');
  const all = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.ok(all[6][0].replace(/\s/g, '').includes('D999999-1')); // owner 甲 before 乙, despite reversed ledger order
  const body = all
    .slice(6)
    .map((r) => r[3] ?? '')
    .join('\n');
  assert.equal((body.match(/Long content/g) ?? []).length, 150);
  assert.equal(all.slice(6).filter((r) => r[3]?.includes('Long content')).length, 1);
  assert.ok(wrapExportText('中'.repeat(100), 43).length > 1);
  assert.deepEqual(wrapExportText('Please provide supporting calculation', 24), [
    'Please provide',
    'supporting',
    'calculation',
  ]);
});
test('opinions that fit one physical row retain native Excel filtering and adaptive height', () => {
  const comments = fixture([
    {
      ...row('D999999-1', 1),
      Title: '',
      Description: Array(21).fill('A readable line').join('\n'),
    },
  ]);
  const cases = buildOpenCommentCases({ catalog: catalog(), comments });
  const files = unzipSync(exportOpenCases(cases, exportContext));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(!sheet.includes('（续）'));
  assert.ok(sheet.includes('autoFilter'));
  assert.ok([...sheet.matchAll(/ ht="(\d+)"/g)].some((m) => Number(m[1]) > 300));
});

test('per-drawing replies retain all messages, preserve blank next-reply position and safe unique filenames', () => {
  const comments = fixture([
    row('D999999-1', 1),
    row('D999999-1_1', 2, 'Yard Design', true),
    row('D999999-1_2', 3, 'Approval Expert', true),
  ]);
  const cases = buildOpenCommentCases({ catalog: catalog(), comments }),
    d = cases[0].drawings[0];
  const bytes = exportDrawingReplies(cases, d, exportContext);
  const wb = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const text = rows.flat().join('\n');
  assert.ok(text.includes('D999999-1_1'));
  assert.ok(text.includes('D999999-1_2'));
  const blank = rows.find((r) => r[0] === '待填');
  assert.ok(blank);
  assert.equal(blank![3], '');
  const files = unzipSync(
    exportDrawingReplyPackage(cases, exportContext, {
      'TEST-001': { cn: '特殊/图名', owner: '甲:乙' },
    }),
  );
  assert.ok(files['TEST-001-特殊_图名-甲_乙-DNV.xlsx']);
});
