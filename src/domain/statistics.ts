import type { CommentMessage, DocumentRecord } from './contracts';
import type { Summary, ToolState } from './model';
import { buildDrawingSummaries, isFull, messageKey } from './derive';

export type DrawingStage = 'closed' | 'open' | 'not-applicable' | 'uncertain';
export const stageLabels: Record<DrawingStage, string> = {
  closed: '已闭环',
  open: '有未关闭意见',
  'not-applicable': 'FI/DI，闭环不适用',
  uncertain: '闭环待确认',
};
export interface StatisticsDrawing {
  summary: Summary;
  document: DocumentRecord | null;
  sent: boolean;
  returned: boolean;
  stage: DrawingStage;
}
export type DrawingMetric =
  | 'required'
  | 'sent'
  | 'unsent'
  | 'returned'
  | 'awaiting'
  | 'closed'
  | 'open'
  | 'not-applicable'
  | 'uncertain';
export const metricLabels: Record<DrawingMetric, string> = {
  required: '应送船检',
  sent: '已送审',
  unsent: '无有效送审记录',
  returned: '已退审（已返回）',
  awaiting: '未退审（待返回）',
  closed: '已闭环',
  open: '有未关闭意见',
  'not-applicable': '闭环不适用',
  uncertain: '闭环待确认',
};
export const ratio = (numerator: number, denominator: number): number | null =>
  denominator ? numerator / denominator : null;

export function matchesMetric(row: StatisticsDrawing, metric: DrawingMetric): boolean {
  switch (metric) {
    case 'required':
      return true;
    case 'sent':
      return row.sent;
    case 'unsent':
      return !row.sent;
    case 'returned':
      return row.returned;
    case 'awaiting':
      return row.sent && !row.returned;
    default:
      return row.returned && row.stage === metric;
  }
}

export function buildStatistics(state: ToolState) {
  const docs = state.documents.at(-1) ?? null;
  const comments = state.comments.at(-1) ?? null;
  const excluded = new Set(state.catalog?.statistics?.excludedDrawingNos ?? []);
  const eligible = state.catalog?.catalog.drawings.filter((d) => d.dnvRequired === true) ?? [];
  const followed = eligible.filter((d) => !excluded.has(d.drawingNo)).map((d) => d.drawingNo);
  const summaries = state.catalog
    ? buildDrawingSummaries({ ...state.catalog, followed }, docs, comments)
    : [];
  const rows: StatisticsDrawing[] = summaries.map((summary) => {
    // A status is useful evidence even when the source did not supply a valid Sent Date.
    // A historical response must never mask a newer submission awaiting a response.
    const document =
      summary.currentDocument ??
      [...summary.history]
        .filter((d) => ['Sent', 'Received'].includes(d.status))
        .sort((a, b) => (b.received.iso ?? '').localeCompare(a.received.iso ?? ''))[0] ??
      null;
    const sent = Boolean(
      document?.sent.iso || (document && ['Sent', 'Received'].includes(document.status)),
    );
    const returned =
      sent &&
      Boolean(
        document?.received.iso || document?.approvalStatus || document?.status === 'Received',
      );
    let stage: DrawingStage = 'uncertain';
    if (returned && summary.openCount) stage = 'open';
    else if (returned && ['FI', 'DI'].includes(document?.approvalStatus ?? ''))
      stage = 'not-applicable';
    else if (
      returned &&
      docs &&
      isFull(docs.source) &&
      comments &&
      isFull(comments.source) &&
      !summary.staleDocuments &&
      !summary.staleComments &&
      !summary.otherCount &&
      (document?.openComments === null || document?.openComments === 0) &&
      ((['AP', 'AC'].includes(document?.approvalStatus ?? '') &&
        summary.uniqueParentCount > 0 &&
        summary.closedCount === summary.uniqueParentCount) ||
        document?.approvalStatus === 'AP')
    )
      stage = 'closed';
    return { summary, document, sent, returned, stage };
  });
  const parents = [
    ...new Map(summaries.flatMap((s) => s.parents).map((p) => [messageKey(p), p])).values(),
  ];
  const metrics = Object.fromEntries(
    (Object.keys(metricLabels) as DrawingMetric[]).map((key) => [
      key,
      rows.filter((row) => matchesMetric(row, key)).length,
    ]),
  ) as Record<DrawingMetric, number>;
  const openParents = parents.filter((p) => p.status === 'Open');
  const closedParents = parents.filter((p) => p.status === 'Closed');
  const roles = Object.fromEntries(
    [...new Set(openParents.map((p) => p.actionNeededBy || '未指定'))].map((role) => [
      role,
      openParents.filter((p) => (p.actionNeededBy || '未指定') === role).length,
    ]),
  );
  const approvalCodes = Object.fromEntries(
    [
      ...new Set(
        rows.filter((r) => r.returned).map((r) => r.document?.approvalStatus || '未提供代码'),
      ),
    ]
      .sort()
      .map((code) => [
        code,
        rows.filter((r) => r.returned && (r.document?.approvalStatus || '未提供代码') === code)
          .length,
      ]),
  );
  return {
    rows,
    parents,
    metrics,
    roles,
    approvalCodes,
    available: {
      catalog: Boolean(state.catalog),
      documents: Boolean(docs),
      comments: Boolean(comments),
    },
    complete: {
      documents: Boolean(docs && isFull(docs.source)),
      comments: Boolean(comments && isFull(comments.source)),
    },
    excluded: eligible.filter((d) => excluded.has(d.drawingNo)).length,
    unconfirmedDnv:
      state.catalog?.catalog.drawings.filter((d) => d.dnvRequired === null).length ?? 0,
    comments: {
      total: parents.length,
      open: openParents.length,
      closed: closedParents.length,
      other: parents.length - openParents.length - closedParents.length,
    },
    rates: {
      sent: ratio(metrics.sent, metrics.required),
      returned: ratio(metrics.returned, metrics.sent),
      closed: ratio(metrics.closed, metrics.returned),
      comments: ratio(closedParents.length, parents.length),
    },
  };
}
export type Statistics = ReturnType<typeof buildStatistics>;

export function linkedRows(parent: CommentMessage, rows: StatisticsDrawing[]) {
  const ids = new Set(parent.links.map((l) => l.drawingNo));
  return rows.filter((r) => ids.has(r.summary.drawingNo));
}
