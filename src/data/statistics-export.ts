import { strToU8, zipSync } from 'fflate';
import type { Statistics } from '../domain/statistics';
import { linkedRows, metricLabels, stageLabels } from '../domain/statistics';
import type { ToolState } from '../domain/model';

// Spreadsheet programs must treat imported titles and descriptions as text.
export function csv(rows: unknown[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function statisticsPackage(state: ToolState, statistics: Statistics): Uint8Array {
  const date = (v: string | null | undefined) => v?.slice(0, 10) ?? '';
  const metadata = [
    ['项目', state.project?.name ?? ''],
    ['统计范围', '台账明确勾选DNV的图纸，扣除人工排除清单；不受图纸关注列表影响'],
    ['排除图号', (state.catalog?.statistics?.excludedDrawingNos ?? []).join('、')],
    ['Documents文件', state.documents.at(-1)?.source.filename ?? '未导入'],
    ['Documents资料日期', state.documents.at(-1)?.source.dataDate ?? '未提供'],
    ['Documents范围', statistics.complete.documents ? '已确认完整' : '未确认完整或未导入'],
    ['Comments文件', state.comments.at(-1)?.source.filename ?? '未导入'],
    ['Comments资料日期', state.comments.at(-1)?.source.dataDate ?? '未提供'],
    ['Comments范围', statistics.complete.comments ? '已确认完整' : '未确认完整或未导入'],
  ];
  const overview: unknown[][] = [...metadata, [], ['指标', '数量 / 比率']];
  for (const [key, label] of Object.entries(metricLabels))
    overview.push([
      label,
      key === 'required'
        ? statistics.available.catalog
          ? statistics.metrics.required
          : '未导入台账'
        : statistics.available.documents
          ? statistics.metrics[key as keyof typeof statistics.metrics]
          : '未导入Documents',
    ]);
  for (const [key, label] of [
    ['sent', '送审率'],
    ['returned', '退审率'],
    ['closed', '图纸闭环率'],
    ['comments', '意见关闭率'],
  ] as const)
    overview.push([
      label,
      (key === 'comments'
        ? statistics.available.comments
        : key === 'closed'
          ? statistics.available.documents && statistics.available.comments
          : statistics.available.documents) && statistics.rates[key] !== null
        ? `${(statistics.rates[key]! * 100).toFixed(1)}%`
        : '暂无可计算数据',
    ]);
  for (const [key, label] of [
    ['total', '父意见总数'],
    ['open', '未关闭父意见'],
    ['closed', '已关闭父意见'],
    ['other', '其他状态父意见'],
  ] as const)
    overview.push([
      label,
      statistics.available.comments ? statistics.comments[key] : '未导入Comments',
    ]);
  overview.push(
    [],
    ['DNV返回代码', '图纸数'],
    ...Object.entries(statistics.approvalCodes),
    [],
    ['Open责任方', '父意见数'],
    ...Object.entries(statistics.roles),
  );
  const drawings: unknown[][] = [
    [
      '序号',
      '图号',
      '图名',
      '负责人',
      '送审记录',
      '最新版本',
      '送审日期',
      '对应返回日期',
      '批复代码',
      '当前闭环分类',
      '父意见数',
      'Open',
      'Closed',
      '其他状态',
      '设计侧Open',
      '最近船厂回复活动',
      '最近DNV回复活动',
      '数据提示',
    ],
  ];
  for (const r of statistics.rows)
    drawings.push([
      r.summary.sequence,
      r.summary.drawingNo,
      r.summary.cn || r.summary.en,
      r.summary.owner,
      !statistics.available.documents ? 'Documents未导入' : r.sent ? '已送审' : '无有效送审记录',
      r.document?.revision,
      date(r.document?.sent.iso),
      date(r.document?.received.iso),
      r.document?.approvalStatus,
      !statistics.available.documents
        ? '资料未导入'
        : r.returned
          ? stageLabels[r.stage]
          : r.sent
            ? '待返回'
            : '无有效送审记录',
      ...(!statistics.available.comments
        ? ['未导入', '未导入', '未导入', '未导入', '未导入']
        : [
            r.summary.uniqueParentCount,
            r.summary.openCount,
            r.summary.closedCount,
            r.summary.otherCount,
            r.summary.candidateYardDesignCount,
          ]),
      r.summary.lastYardActivity,
      r.summary.lastDnvActivity,
      r.summary.note,
    ]);
  const opinions: unknown[][] = [
    [
      'Comment ID',
      '关联图号（本次范围）',
      '关联图名',
      '负责人',
      '状态',
      '意见类型',
      '当前责任方',
      '标题',
      '正文',
      '专业',
      'Issue Date',
      'Last Activity',
      'Closed Date',
    ],
  ];
  for (const p of statistics.parents) {
    const linked = linkedRows(p, statistics.rows);
    opinions.push([
      p.messageId,
      linked.map((r) => r.summary.drawingNo).join('、'),
      linked.map((r) => r.summary.cn || r.summary.en).join('、'),
      [...new Set(linked.map((r) => r.summary.owner))].join('、'),
      p.status,
      p.type,
      p.actionNeededBy,
      p.title,
      p.description,
      p.discipline,
      p.issueDate.iso,
      p.lastActivity.iso,
      p.closedDate.iso,
    ]);
  }
  const notes = `DNV统计口径 v0.3.0\n${metadata.map((row) => row.join('：')).join('\n')}\n
1. 应送=台账DNV明确为√的图纸，扣除人工排除图号。排除只影响统计，不删除业务数据。未明确勾选的图纸不擅自计入。
2. 已送=有有效Sent Date或Sent/Received状态。无记录只表示当前数据无有效送审证据，不证明实际从未送审。Documents未导入时不显示未送数量。
3. 按最新有效送审记录判断返回；该记录有Received Date、批复代码或Received状态算已返回。历史版本结果不会覆盖新送审待返回状态。
4. 送审率=已送/应送；退审率=已返回/已送；图纸闭环率=已闭环/已返回。零分母留空。无日期的状态证据仍保留数据提示。
5. 已返回图纸分为有Open、已闭环、FI/DI不适用、待确认。有Open优先；FI/DI且无Open不自动算闭环。仅完整Documents及Comments、无缺失旧数据、无其他意见状态、Documents无矛盾Open数时，AP或AC的全部父意见Closed可计闭环；AP无父意见也可计闭环。
6. 意见总数按项目号+父Comment ID去重，回复不计新意见；跨图纸关联同一父意见只统计一次。仅统计关联本次图纸范围的父意见。Open、Closed、其他状态分别列出，缺失不视为关闭。
7. Open责任方是系统当前责任方，Yard Design不直接等于工程师从未回复。现场、DNV、验船师等分别列出。活动时间不当作正式回复日期。
8. 未确认全项目/全版本/全部状态时，显示所导出范围的暂定统计，不能作完整项目结论。资料日期未知不采用下载时间推断。
9. 图纸逐行顺序沿用文控台账。批复代码和意见关闭是两个维度，未知代码保留原值。此统计不证明资料是否已分发。\n`;
  return zipSync({
    '统计总览.csv': strToU8(csv(overview)),
    '图纸明细.csv': strToU8(csv(drawings)),
    '父意见明细.csv': strToU8(csv(opinions)),
    '统计口径.txt': strToU8(notes),
  });
}
