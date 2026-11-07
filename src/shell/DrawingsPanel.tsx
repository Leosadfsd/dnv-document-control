import { useMemo, useState } from 'react';
import type { ToolState } from '../domain/model';
import { buildDrawingSummaries } from '../domain/derive';
import { Badge, Pager, date } from './components';

export function DrawingsPanel({
  state,
  openDrawing,
  openImports,
}: {
  state: ToolState;
  openDrawing: (no: string) => void;
  openImports: () => void;
}) {
  const [query, setQuery] = useState(''),
    [owner, setOwner] = useState(''),
    [approval, setApproval] = useState(''),
    [page, setPage] = useState(0);
  const summaries = useMemo(
    () =>
      state.catalog
        ? buildDrawingSummaries(
            { ...state.catalog, followed: state.catalog.catalog.drawings.map((d) => d.drawingNo) },
            state.documents.at(-1) ?? null,
            state.comments.at(-1) ?? null,
          )
        : [],
    [state],
  );
  const rows = summaries.filter(
    (s) =>
      (!owner || s.owner === owner) &&
      (!approval || s.currentDocument?.approvalStatus === approval) &&
      (!query.trim() ||
        [s.drawingNo, s.cn, s.en, s.owner]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>图纸查询</h1>
          <span className="muted">台账全部 {summaries.length} 张图纸 · 按台账原顺序</span>
        </div>
        <button onClick={openImports}>导入 / 更新资料</button>
      </div>
      {!state.catalog ? (
        <div className="empty-state">
          <h3>导入台账后，查询全部图纸</h3>
          <button className="primary" onClick={openImports}>
            导入文控台账
          </button>
        </div>
      ) : (
        <>
          <div className="filters">
            <input
              aria-label="搜索图号图名负责人"
              placeholder="图号、图名或负责人"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="负责人筛选"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部负责人</option>
              {[...new Set(summaries.map((s) => s.owner).filter(Boolean))]
                .sort((a, b) => a.localeCompare(b, 'zh-CN'))
                .map((o) => (
                  <option key={o}>{o}</option>
                ))}
            </select>
            <select
              aria-label="批复码筛选"
              value={approval}
              onChange={(e) => {
                setApproval(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部批复代码</option>
              {[
                ...new Set(
                  summaries
                    .map((s) => s.currentDocument?.approvalStatus)
                    .filter((c): c is string => Boolean(c)),
                ),
              ]
                .sort()
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
            <button
              onClick={() => {
                setQuery('');
                setOwner('');
                setApproval('');
                setPage(0);
              }}
            >
              清除筛选
            </button>
          </div>
          <div className="table-scroll">
            <table className="drawings-table simple-drawings">
              <thead>
                <tr>
                  {[
                    '序号',
                    '图号 / 图名',
                    '负责人',
                    'DNV范围',
                    '送审情况',
                    '当前批复',
                    'Open意见',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 50, (page + 1) * 50).map((s) => {
                  const item = state.catalog!.catalog.drawings.find(
                    (d) => d.drawingNo === s.drawingNo,
                  )!;
                  const fallback = s.history.find((d) => ['Sent', 'Received'].includes(d.status));
                  const doc = s.currentDocument ?? fallback;
                  const sent = Boolean(
                    doc?.sent.iso || doc?.status === 'Sent' || doc?.status === 'Received',
                  );
                  return (
                    <tr key={s.drawingNo}>
                      <td>{s.sequence}</td>
                      <td>
                        <button className="drawing-link" onClick={() => openDrawing(s.drawingNo)}>
                          <code>{s.drawingNo}</code>
                          <strong>{s.cn || s.en || '图名待补'}</strong>
                        </button>
                      </td>
                      <td>{s.owner || '负责人待补'}</td>
                      <td>
                        {item.dnvRequired === true
                          ? '涉及'
                          : item.dnvRequired === false
                            ? '台账未标DNV'
                            : '标记待确认'}
                      </td>
                      <td>
                        {!state.documents.length
                          ? 'Documents未导入'
                          : sent
                            ? '已送审'
                            : '无有效送审记录'}
                        {doc && (
                          <small>
                            {doc.revision || '版本未提供'} · {date(doc.sent.iso)}
                          </small>
                        )}
                      </td>
                      <td>
                        <Badge
                          text={doc?.approvalStatus || (sent ? '待返回 / 无代码' : '—')}
                          tone={doc?.approvalStatus ? 'blue' : 'neutral'}
                        />
                        {doc?.received.iso && <small>{date(doc.received.iso)}</small>}
                      </td>
                      <td>
                        {state.comments.length ? s.openCount : 'Comments未导入'}
                        {s.staleComments && <small>含缺失旧记录，需核对</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <p className="empty">未找到匹配图纸</p>}
          </div>
          <Pager total={rows.length} page={page} size={50} setPage={setPage} />
        </>
      )}
    </>
  );
}
