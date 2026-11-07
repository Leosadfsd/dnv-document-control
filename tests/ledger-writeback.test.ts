import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerWriteback } from '../src/domain/ledger-writeback';
import { emptyState, type Summary } from '../src/domain/model';
import type { SourceMeta } from '../src/domain/contracts';
const source: SourceMeta = {
  kind: 'comments',
  filename: 'synthetic.xlsx',
  fingerprint: 's',
  importedAt: '2026-11-07',
  dataDate: null,
  scope: { project: 'all', revisions: 'all', statuses: 'all', confirmedByUser: true },
};
function fixture() {
  const state = emptyState();
  state.documents = [
    {
      snapshotId: 'd',
      projectKey: 'test',
      source: { ...source, kind: 'documents' },
      data: [],
      issues: [],
      missingFromLatest: [],
    },
  ];
  state.comments = [
    {
      snapshotId: 'c',
      projectKey: 'test',
      source,
      data: { messages: [], orphanMessageIds: [] },
      issues: [],
      missingFromLatest: [],
    },
  ];
  const s = {
    history: [
      { received: { iso: '2026-08-01' } },
      { received: { iso: '2026-09-02' } },
      { received: { iso: '2026-10-03' } },
    ],
    currentDocument: { revision: 'R1', sent: { iso: '2026-11-01' }, approvalStatus: '' },
    staleDocuments: false,
    staleComments: false,
    uniqueParentCount: 3,
    openCount: 1,
    closedCount: 2,
    otherCount: 0,
  } as Summary;
  return { state, s };
}
test('ledger writeback updates DNV counts and current submission without inheriting an older approval', () => {
  const { state, s } = fixture();
  const result = ledgerWriteback(s, state);
  assert.deepEqual(result.values, {
    船检版本: 'R1',
    船检送审日期: '2026-11-01',
    批复代码: '',
    DNV退审首次: '2026-08-01',
    DNV退审第二次: '2026-09-02',
    意见总数: 3,
    未闭环意见: 1,
    意见状态: '未闭环',
  });
  assert.ok(result.notes.some((n) => n.includes('3个退审日期')));
  assert.ok(!Object.keys(result.values).some((k) => k.includes('GSI') || k.includes('船东')));
});
test('only complete all-Closed parents yield closed; incomplete scope preserves original status', () => {
  const { state, s } = fixture();
  s.openCount = 0;
  s.closedCount = 3;
  assert.equal(ledgerWriteback(s, state).values['意见状态'], '已闭环');
  state.comments[0].source = { ...source, scope: { ...source.scope, confirmedByUser: false } };
  assert.equal(ledgerWriteback(s, state).values['意见状态'], undefined);
  state.comments[0].source = source;
  s.closedCount = 2;
  s.otherCount = 1;
  assert.equal(ledgerWriteback(s, state).values['意见状态'], '待确认');
});
test('missing or stale source preserves prior ledger values instead of clearing unmatched records', () => {
  const { state, s } = fixture();
  s.staleDocuments = true;
  s.staleComments = true;
  assert.deepEqual(ledgerWriteback(s, state).values, {});
  s.staleDocuments = false;
  s.staleComments = false;
  s.history = [];
  s.uniqueParentCount = 0;
  assert.deepEqual(ledgerWriteback(s, state).values, {});
});
