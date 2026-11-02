import type { Summary, ToolState } from './model';
export const ledgerFields = [
  'DNV最新送审版本',
  'DNV最新送审日期',
  'DNV最新送审状态',
  'DNV最新送审批复日期',
  'DNV最新送审批复码',
  'DNV最近处理版本',
  'DNV最近处理日期',
  'DNV最近处理码',
  'DNV父意见数（所导出）',
  'DNV Open数（所导出）',
  'DNV Closed数（所导出）',
  'DNV其他状态数',
  '设计侧Open数',
  '现场侧Open数',
  'DNV侧Open数',
  '其他责任方Open数',
  '最近船厂回复活动时间',
  '最近DNV回复活动时间',
  'Documents资料日期',
  'Comments资料日期',
  'DNV数据说明',
];
export const dateFieldIndices = new Set([1, 3, 6, 16, 17, 18, 19]);
export function ledgerValues(s: Summary, state: ToolState): Array<string | number | null> {
  const d = s.currentDocument,
    r = s.latestResponse;
  const c = state.comments.at(-1);
  const roles = s.openByRole;
  const known =
    (roles['Yard Design'] ?? 0) +
    (roles['Yard Site'] ?? 0) +
    (roles['Approval Expert'] ?? 0) +
    (roles['NB Surveyor'] ?? 0);
  return [
    d?.revision ?? null,
    d?.sent.iso ?? null,
    d?.status ?? null,
    d?.received.iso ?? null,
    d?.approvalStatus || null,
    r?.revision ?? null,
    r?.received.iso ?? null,
    r?.approvalStatus || null,
    c ? s.uniqueParentCount : null,
    c ? s.openCount : null,
    c ? s.closedCount : null,
    c ? s.otherCount : null,
    c ? (roles['Yard Design'] ?? 0) : null,
    c ? (roles['Yard Site'] ?? 0) : null,
    c ? (roles['Approval Expert'] ?? 0) + (roles['NB Surveyor'] ?? 0) : null,
    c ? s.openCount - known : null,
    s.lastYardActivity,
    s.lastDnvActivity,
    s.sourceDates.documents,
    s.sourceDates.comments,
    [
      s.note,
      c && s.uniqueParentCount === 0 ? '未找到意见记录；数量仅代表所导出内容' : '',
      '往来时间为回复行Last Activity；原船检列仅作历史参考',
    ]
      .filter(Boolean)
      .join('；'),
  ];
}
