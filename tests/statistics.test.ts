import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { parseCatalog, parseComments, parseDocuments } from '../src/domain/parse';
import { applyImport } from '../src/domain/derive';
import { emptyState } from '../src/domain/model';
import { buildStatistics, matchesMetric, ratio } from '../src/domain/statistics';
import { statisticsPackage, csv } from '../src/data/statistics-export';
import { validateBackup, exportBackup } from '../src/data/storage';
import type { ImportContext, Rows, SourceMeta } from '../src/domain/contracts';

const project = { projectKey: 'stats', projectId: '42', name: 'Statistics test' };
const context = (kind: SourceMeta['kind']): ImportContext => ({
  project,
  source: {
    kind,
    filename: 'synthetic.xlsx',
    fingerprint: 'test',
    importedAt: '2026-11-01T00:00:00Z',
    dataDate: null,
    scope: { project: 'all', revisions: 'all', statuses: 'all', confirmedByUser: true },
  },
});
const catalogRows = ['K001', 'K002', 'K003', 'K004', 'K005'].map((no, i) => ({
  'Drawing Number': no,
  'Drawing Name': `测试${i}`,
  系统负责人: i < 2 ? '甲' : '乙',
  DNV: i === 4 ? '' : '√',
}));
const doc = (
  no: string,
  code = 'AC',
  sent = '2026-09-01',
  received = '2026-09-02',
  status = 'Received',
  rev = 'R0',
) => ({
  __row: 2,
  'Document No.': no,
  'Document Title': 'Synthetic',
  Revision: rev,
  Status: status,
  'Approval Status': code,
  'Sent Date': sent,
  'Received Date': received,
  'Open comments': 0,
});
const parent = (id: string, no: string, status = 'Closed', reply = false) => ({
  __row: 2,
  'Project Id': '42',
  CommentId: id,
  'Is Reply': reply ? 'Y' : '',
  'Id Sort Order': 1,
  Status: status,
  Type: 'Action Required',
  Title: 'Synthetic',
  Description: 'Synthetic',
  'Issued By Role': reply ? 'Yard Design' : 'Approval Expert',
  'Action Needed By': 'Yard Design',
  'Issue Date': '2026-09-02',
  'Last Activity': '2026-09-02',
  'Closed Date': '',
  'Document no': no,
  'Document rev': 'R0',
});
function fixture(docs: Rows = [], messages: Rows = []) {
  let state = applyImport(
    { ...emptyState(), project },
    {
      kind: 'catalog',
      source: context('catalog').source,
      result: parseCatalog(catalogRows, context('catalog')),
      rawRows: 5,
    },
  );
  if (docs.length)
    state = applyImport(state, {
      kind: 'documents',
      source: context('documents').source,
      result: parseDocuments(docs, context('documents')),
      rawRows: docs.length,
    });
  if (messages.length)
    state = applyImport(state, {
      kind: 'comments',
      source: context('comments').source,
      result: parseComments(messages, context('comments')),
      rawRows: messages.length,
    });
  return state;
}
test('statistics follows explicit DNV scope and exclusions, not user attention list; backup/reimport retain scope', () => {
  const state = fixture([doc('K001')]);
  state.catalog!.followed = [];
  state.catalog!.statistics = { excludedDrawingNos: ['K002'] };
  assert.equal(buildStatistics(state).metrics.required, 3);
  assert.deepEqual(
    buildStatistics(state).rows.map((r) => r.summary.drawingNo),
    ['K001', 'K003', 'K004'],
  );
  assert.deepEqual(
    validateBackup(exportBackup(state)).catalog?.statistics,
    state.catalog!.statistics,
  );
  const next = applyImport(state, {
    kind: 'catalog',
    source: context('catalog').source,
    result: parseCatalog(catalogRows, context('catalog')),
    rawRows: 5,
  });
  assert.deepEqual(next.catalog?.statistics, state.catalog!.statistics);
  const bad = JSON.parse(exportBackup(state));
  bad.catalog.statistics.excludedDrawingNos = ['MISSING'];
  assert.throws(() => validateBackup(JSON.stringify(bad)), /排除图号/);
});
test('latest pending submission cannot use historical approval; status without Sent date is still submission evidence', () => {
  const state = fixture([
    doc('K001'),
    doc('K001', '', '2026-10-01', '', 'Sent', 'R1'),
    doc('K002', 'FI', '', '2026-09-02'),
  ]);
  const stats = buildStatistics(state);
  assert.equal(stats.metrics.sent, 2);
  assert.equal(stats.metrics.returned, 1);
  assert.equal(stats.metrics.awaiting, 1);
  assert.equal(stats.rows[0].returned, false);
  assert.equal(stats.rows[1].sent, true);
});
test('cross-linked parent deduplicates; replies and outside-scope opinions do not increase totals; other status stays separate', () => {
  const stats = buildStatistics(
    fixture(
      [doc('K001'), doc('K002')],
      [
        parent('D42-1', 'K001', 'Open'),
        parent('D42-1', 'K002', 'Open'),
        parent('D42-1_1', 'K001', 'Open', true),
        parent('D42-2', 'K001', 'NA'),
        parent('D42-3', 'K005'),
      ],
    ),
  );
  assert.equal(stats.comments.total, 2);
  assert.equal(stats.comments.open, 1);
  assert.equal(stats.comments.other, 1);
  assert.equal(stats.roles['Yard Design'], 1);
  assert.equal(stats.rows[0].summary.openCount + stats.rows[1].summary.openCount, 2);
});
test('FI/DI without Open never become closed; incomplete/retained data prevents inferred closure; all buckets reconcile', () => {
  const state = fixture(
    [doc('K001', 'AP'), doc('K002', 'FI'), doc('K003', 'DI'), doc('K004', 'AC')],
    [parent('D42-1', 'K001'), parent('D42-2', 'K004')],
  );
  let stats = buildStatistics(state);
  assert.equal(stats.metrics.closed, 2);
  assert.equal(stats.metrics['not-applicable'], 2);
  assert.equal(
    stats.metrics.returned,
    stats.metrics.closed +
      stats.metrics.open +
      stats.metrics['not-applicable'] +
      stats.metrics.uncertain,
  );
  assert.equal(stats.metrics.required, stats.metrics.sent + stats.metrics.unsent);
  state.comments[0].source.scope.statuses = 'open-only';
  stats = buildStatistics(state);
  assert.equal(stats.metrics.closed, 0);
  assert.equal(stats.metrics.uncertain, 2);
  state.comments[0].source.scope.statuses = 'all';
  state.comments[0].missingFromLatest = ['["42","D42-1"]'];
  stats = buildStatistics(state);
  assert.equal(stats.metrics.closed, 1);
  for (const key of Object.keys(stats.metrics) as Array<keyof typeof stats.metrics>)
    assert.equal(stats.rows.filter((r) => matchesMetric(r, key)).length, stats.metrics[key]);
});
test('NP and unknown approval codes remain uncertain even if opinions are Closed; denominator zero is blank', () => {
  const stats = buildStatistics(
    fixture(
      [doc('K001', 'NP'), doc('K002', 'X')],
      [parent('D42-1', 'K001'), parent('D42-2', 'K002')],
    ),
  );
  assert.equal(stats.metrics.closed, 0);
  assert.equal(stats.metrics.uncertain, 2);
  assert.equal(ratio(0, 0), null);
  assert.equal(buildStatistics(fixture()).available.documents, false);
});
test('export ZIP contains reconciled total/details/method with UTF-8 BOM and neutralizes CSV formulas', () => {
  const state = fixture([doc('K001')], [parent('D42-1', 'K001')]);
  const stats = buildStatistics(state),
    files = unzipSync(statisticsPackage(state, stats));
  assert.equal(Object.keys(files).length, 4);
  assert.match(strFromU8(files['统计总览.csv']), /父意见总数/);
  assert.match(strFromU8(files['图纸明细.csv']), /K001/);
  assert.match(strFromU8(files['父意见明细.csv']), /D42-1/);
  assert.equal(files['父意见明细.csv'][0], 0xef);
  assert.match(
    csv([['=1+1', '@SUM(A1)', 'normal', 'a"b']]),
    /"'=1\+1","'@SUM\(A1\)","normal","a""b"/,
  );
});
