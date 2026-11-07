import type { Summary, ToolState } from './model';
import { isFull } from './derive';

export const writebackFields = [
  '船检送审日期',
  '船检版本',
  '意见状态',
  '意见总数',
  '未闭环意见',
  'DNV退审首次',
  'DNV退审第二次',
  '批复代码',
] as const;
export type WritebackField = (typeof writebackFields)[number];
export interface LedgerWriteback {
  values: Partial<Record<WritebackField, string | number>>;
  notes: string[];
}
export function ledgerWriteback(s: Summary, state: ToolState): LedgerWriteback {
  const values: LedgerWriteback['values'] = {},
    notes: string[] = [];
  const doc = state.documents.at(-1),
    comments = state.comments.at(-1);
  const current = s.currentDocument;
  if (doc && s.history.length && !s.staleDocuments) {
    if (current) {
      values['船检版本'] = /^\d+$/.test(current.revision)
        ? `R${current.revision}`
        : current.revision;
      if (current.sent.iso) values['船检送审日期'] = current.sent.iso.slice(0, 10);
      // A new submission without a result must not inherit an old approval code.
      values['批复代码'] = current.approvalStatus || '';
    } else notes.push('图纸卡无有效送审记录，保留原版本及批复代码');
    const dates = [
      ...new Set(s.history.flatMap((r) => (r.received.iso ? [r.received.iso.slice(0, 10)] : []))),
    ].sort();
    if (dates.length) values['DNV退审首次'] = dates[0];
    if (dates.length > 1) values['DNV退审第二次'] = dates[1];
    if (dates.length > 2)
      notes.push(`存在${dates.length}个退审日期，原表仅写前两次：${dates.join('、')}`);
  } else notes.push('Documents缺失、未匹配或含缺失记录，保留原船检送审及批复字段');
  if (comments && s.uniqueParentCount > 0 && !s.staleComments) {
    values['意见总数'] = s.uniqueParentCount;
    values['未闭环意见'] = s.openCount;
    if (s.openCount > 0) values['意见状态'] = '未闭环';
    else if (isFull(comments.source))
      values['意见状态'] = s.closedCount === s.uniqueParentCount ? '已闭环' : '待确认';
    else notes.push('零Open但来源范围未确认，保留原闭环状态');
    if (!isFull(comments.source))
      notes.push('意见数量取所导出父意见，来源范围未确认完整，不能据零Open断言全部闭环');
    if (s.otherCount) notes.push(`${s.otherCount}条父意见为Open/Closed之外的状态`);
  } else notes.push('Comments未导入、未匹配父意见或含缺失记录，保留原意见状态及数量');
  return { values, notes };
}
