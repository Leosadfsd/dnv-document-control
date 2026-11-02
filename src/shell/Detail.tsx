import { useMemo, useState } from 'react';
import { ExternalLink, Pencil, Save } from 'lucide-react';
import type { Summary, ToolState } from '../domain/model';
import { threadOrder } from '../domain/rules';
import { Modal, Badge, Pager, date, stamp, roleLabel, stateLabel } from './components';

export function Detail({
  summary: s,
  state,
  close,
  saveOverride,
}: {
  summary: Summary;
  state: ToolState;
  close: () => void;
  saveOverride: (no: string, cn: string, owner: string) => Promise<void>;
}) {
  const [view, setView] = useState<'comments' | 'versions'>('comments');
  const [selected, setSelected] = useState<string | null>(null),
    [threadPage, setThreadPage] = useState(0),
    [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(false),
    [cn, setCn] = useState(s.cn),
    [owner, setOwner] = useState(s.owner),
    [error, setError] = useState('');
  const thread = useMemo(
    () =>
      threadOrder(
        (state.comments.at(-1)?.data.messages ?? []).filter((m) => m.parentId === selected),
      ),
    [state.comments, selected],
  );
  const parents = s.parents.filter((p) => filter === 'all' || p.status === filter);
  return (
    <Modal title={`${s.drawingNo} · ${s.cn || s.en}`} close={close} wide>
      <div className="detail-meta">
        <span>
          {s.owner || '未填写负责人'} · {s.department || '—'}
        </span>
        <button
          className="icon"
          title="修改基础资料"
          aria-label="修改基础资料"
          onClick={() => setEditing(!editing)}
        >
          <Pencil size={16} />
        </button>
      </div>
      {editing && (
        <form
          className="inline-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await saveOverride(s.drawingNo, cn, owner);
              setEditing(false);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <label>
            中文图名
            <input value={cn} onChange={(e) => setCn(e.target.value)} />
          </label>
          <label>
            负责人
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <button type="submit">
            <Save size={16} />
            保存
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
      <div className="detail-facts">
        <div>
          <small>最新送审</small>
          <strong>{s.currentDocument?.revision || '—'}</strong>
          <span>{date(s.currentDocument?.sent.iso)}</span>
        </div>
        <div>
          <small>对应结果</small>
          <strong>{s.currentDocument?.approvalStatus || '—'}</strong>
          <span>{date(s.currentDocument?.received.iso)}</span>
        </div>
        <div>
          <small>最近历史处理</small>
          <strong>
            {s.latestResponse
              ? `${s.latestResponse.revision} / ${s.latestResponse.approvalStatus}`
              : '—'}
          </strong>
          <span>{date(s.latestResponse?.received.iso)}</span>
        </div>
        <div>
          <small>意见（所导出）</small>
          <strong>{s.uniqueParentCount} 条</strong>
          <span>
            Open {s.openCount} · Closed {s.closedCount}
          </span>
        </div>
      </div>
      {s.note && <p className="notice">{s.note}</p>}
      <div className="role-strip">
        {Object.entries(s.openByRole).map(([role, n]) => (
          <span key={role}>
            {roleLabel(role)} Open <b>{n}</b>
          </span>
        ))}
      </div>
      <div className="source-dates">
        <span>Documents资料日期 {date(s.sourceDates.documents)}</span>
        <span>Comments资料日期 {date(s.sourceDates.comments)}</span>
      </div>
      <div className="segmented">
        <button aria-pressed={view === 'comments'} onClick={() => setView('comments')}>
          意见与往来
        </button>
        <button aria-pressed={view === 'versions'} onClick={() => setView('versions')}>
          版本历史
        </button>
      </div>
      {view === 'versions' ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>送审日期</th>
                <th>处理日期</th>
                <th>状态</th>
                <th>结果码</th>
                <th>Documents Open</th>
              </tr>
            </thead>
            <tbody>
              {[...s.history]
                .sort((a, b) => (b.sent.iso ?? '').localeCompare(a.sent.iso ?? ''))
                .map((r, i) => (
                  <tr key={i}>
                    <td>{r.revision || '—'}</td>
                    <td>{stamp(r.sent.iso) || r.sent.raw}</td>
                    <td>{stamp(r.received.iso)}</td>
                    <td>{stateLabel(r.status) || '无状态'}</td>
                    <td>{r.approvalStatus || '—'}</td>
                    <td>{r.openComments ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="list-tools">
            <select
              aria-label="意见状态筛选"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">所有意见</option>
              <option>Open</option>
              <option>Closed</option>
              <option>NA</option>
            </select>
            <span>{parents.length} 个父意见</span>
          </div>
          {!parents.length && <p className="empty">未找到意见记录</p>}
          <div className="comment-list">
            {parents.map((p) => (
              <article key={p.messageId} className={selected === p.messageId ? 'selected' : ''}>
                <button
                  className="comment-heading"
                  onClick={() => {
                    setSelected(selected === p.messageId ? null : p.messageId);
                    setThreadPage(0);
                  }}
                >
                  <strong>
                    {p.messageId} · {p.title || p.type}
                  </strong>
                  <Badge
                    text={p.status}
                    tone={
                      p.status === 'Open' ? 'amber' : p.status === 'Closed' ? 'green' : 'neutral'
                    }
                  />
                </button>
                <div className="comment-meta">
                  {p.type} · {roleLabel(p.actionNeededBy)} · 最近活动 {stamp(p.lastActivity.iso)}
                </div>
                <p className="body-text">{p.description}</p>
                {selected === p.messageId && (
                  <div className="thread">
                    <div className="thread-title">
                      完整往来 <span>{thread.length} 条消息</span>
                    </div>
                    {thread.slice(threadPage * 20, (threadPage + 1) * 20).map((m, i) => (
                      <div
                        className={`message ${m.issuedByRole.startsWith('Yard') ? 'yard' : 'dnv'}`}
                        key={m.messageId}
                      >
                        <div className="message-meta">
                          <b>{m.kind === 'parent' ? '原始意见' : roleLabel(m.issuedByRole)}</b>
                          <span>
                            {stamp(m.kind === 'parent' ? m.issueDate.iso : m.lastActivity.iso)}
                          </span>
                          <code>{m.messageId}</code>
                        </div>
                        <strong>{m.title}</strong>
                        <p className="body-text">{m.description}</p>
                        <div className="linked-drawings">
                          {m.links.map((l) => (
                            <span key={l.drawingNo + l.revision}>
                              {l.drawingNo} · {l.revision}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <Pager
                      total={thread.length}
                      page={threadPage}
                      size={20}
                      setPage={setThreadPage}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <div className="detail-footer">
        <span>船厂回复活动 {stamp(s.lastYardActivity)}</span>
        <span>DNV回复活动 {stamp(s.lastDnvActivity)}</span>
      </div>
    </Modal>
  );
}
