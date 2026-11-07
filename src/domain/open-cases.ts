import type { CatalogState, CommentMessage, CommentsData, Snapshot } from './contracts';
import { isFull, messageKey } from './derive';
import { threadOrder } from './rules';

export type ActionParty = 'design' | 'site' | 'dnv' | 'confirm';
export const partyLabels: Record<ActionParty, string> = {
  design: '我方设计',
  site: '船厂现场',
  dnv: '船检',
  confirm: '待确认',
};
export interface CaseDrawing {
  drawingNo: string;
  cn: string;
  en: string;
  owner: string;
  sequence: number;
  matched: boolean;
  revisions: string[];
}
export interface OpenCommentCase {
  key: string;
  parent: CommentMessage;
  drawings: CaseDrawing[];
  thread: CommentMessage[];
  latestYardRound: CommentMessage[];
  latestDnvRound: CommentMessage[];
  party: ActionParty;
  systemRole: string;
  reason: string;
  warnings: string[];
  orderReliable: boolean;
  latestActivity: string | null;
  inCatalog: boolean;
}
export interface OpenCasesInput {
  catalog: CatalogState | null;
  comments: Snapshot<CommentsData> | null;
}
const side = (m: CommentMessage) =>
  ['Yard Design', 'Yard Site'].includes(m.issuedByRole)
    ? 'yard'
    : ['Approval Expert', 'NB Surveyor'].includes(m.issuedByRole)
      ? 'dnv'
      : 'other';

function lastRounds(replies: CommentMessage[]) {
  const blocks: Array<{ side: string; messages: CommentMessage[] }> = [];
  for (const m of replies) {
    const s = side(m),
      last = blocks.at(-1);
    if (last?.side === s) last.messages.push(m);
    else blocks.push({ side: s, messages: [m] });
  }
  return {
    yard: blocks.filter((b) => b.side === 'yard').at(-1)?.messages ?? [],
    dnv: blocks.filter((b) => b.side === 'dnv').at(-1)?.messages ?? [],
  };
}

// Derived, persistence-free interface: both the standalone shell and a future host call this.
export function buildOpenCommentCases({ catalog, comments }: OpenCasesInput): OpenCommentCase[] {
  if (!comments) return [];
  const basis = new Map(
    catalog?.catalog.drawings.map((d, i) => [
      d.drawingNo,
      {
        ...d,
        ...catalog.overrides[d.drawingNo],
        sequence: i + 1,
      },
    ]) ?? [],
  );
  const byParent = new Map<string, CommentMessage[]>();
  for (const m of comments.data.messages)
    if (m.parentId) {
      const key = JSON.stringify([m.projectId, m.parentId]);
      const list = byParent.get(key) ?? [];
      list.push(m);
      byParent.set(key, list);
    }
  const missing = new Set(comments.missingFromLatest);
  return comments.data.messages
    .filter((p) => p.kind === 'parent' && p.status === 'Open')
    .map((parent) => {
      const key = messageKey(parent);
      const thread = [
        parent,
        ...threadOrder((byParent.get(key) ?? []).filter((m) => m.kind === 'reply')),
      ];
      const replies = thread.filter((m) => m.kind === 'reply');
      const numbers = [...new Set(parent.links.map((l) => l.drawingNo))];
      const drawings: CaseDrawing[] = numbers
        .map((no) => {
          const d = basis.get(no);
          return {
            drawingNo: no,
            cn: d?.cn ?? '',
            en: d?.en ?? '',
            owner: d?.owner ?? '',
            sequence: d?.sequence ?? Number.MAX_SAFE_INTEGER,
            matched: Boolean(d),
            revisions: [
              ...new Set(parent.links.filter((l) => l.drawingNo === no).map((l) => l.revision)),
            ],
          };
        })
        .sort((a, b) => a.sequence - b.sequence || a.drawingNo.localeCompare(b.drawingNo));
      const stale =
        thread.some((m) => missing.has(messageKey(m))) ||
        (comments.missingLinks ?? []).some((l) => thread.some((m) => m.messageId === l.messageId));
      const orders = thread.map((m) => m.sortOrder);
      const orderReliable =
        orders.every((o) => o !== null) && new Set(orders).size === orders.length;
      const warnings = [
        !catalog
          ? '未关联台账，当前为导出项目范围'
          : drawings.some((d) => !d.matched) || !drawings.length
            ? '存在未匹配台账的图纸'
            : '',
        !isFull(comments.source) ? '来源范围未确认完整，最近往来仅代表已导入内容' : '',
        stale ? '本次缺失部分记录，保留旧内容，回方待确认' : '',
        !orderReliable ? '消息顺序不完整或重复，最近往来需核对' : '',
      ].filter(Boolean);
      const role = parent.actionNeededBy;
      const mapped: ActionParty =
        role === 'Yard Design'
          ? 'design'
          : role === 'Yard Site'
            ? 'site'
            : ['Approval Expert', 'NB Surveyor'].includes(role)
              ? 'dnv'
              : 'confirm';
      const rounds = lastRounds(replies);
      return {
        key,
        parent,
        drawings,
        thread,
        latestYardRound: rounds.yard,
        latestDnvRound: rounds.dnv,
        party: stale ? ('confirm' as const) : mapped,
        systemRole: role,
        reason: stale
          ? '缺失记录，不能确认当前回方'
          : mapped === 'confirm'
            ? `系统未提供可识别的当前责任方${role ? `（${role}）` : ''}`
            : `依据主意见 Action Needed By = ${role}`,
        warnings,
        orderReliable,
        inCatalog: drawings.some((d) => d.matched),
        latestActivity:
          thread
            .map((m) => m.lastActivity.iso)
            .filter((t): t is string => Boolean(t))
            .sort()
            .at(-1) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Math.min(...a.drawings.map((d) => d.sequence), Number.MAX_SAFE_INTEGER) -
          Math.min(...b.drawings.map((d) => d.sequence), Number.MAX_SAFE_INTEGER) ||
        a.parent.messageId.localeCompare(b.parent.messageId, undefined, { numeric: true }),
    );
}

export function messageText(m: CommentMessage): string {
  const role =
    (
      {
        'Yard Design': '船厂设计',
        'Yard Site': '船厂现场',
        'Approval Expert': 'DNV审图',
        'NB Surveyor': '验船师',
      } as Record<string, string>
    )[m.issuedByRole] ||
    m.issuedByRole ||
    '未提供角色';
  const time = m.kind === 'parent' ? m.issueDate.iso : m.lastActivity.iso;
  return `${m.messageId} · ${role}${time ? ` · ${time.slice(0, 16).replace('T', ' ')}` : ''}\n${m.title}${m.title && m.description ? '\n' : ''}${m.description}`;
}
