import { useMemo, useState } from 'react';
import { Download, Upload, MessageSquare, ChevronDown } from 'lucide-react';
import type { ToolState } from '../domain/model';
import {
  buildOpenCommentCases,
  messageText,
  partyLabels,
  type OpenCommentCase,
  type ActionParty,
} from '../domain/open-cases';
import {
  exportOpenCases,
  exportDrawingReplyPackage,
  exportDrawingGroups,
  type DrawingExportOverride,
  type OpinionExportContext,
} from '../data/opinion-export';
import { isFull } from '../domain/derive';
import { download } from '../data/ledger-export';
import { Badge, Modal, Pager, stamp, localDay, localStamp } from './components';

export function OpenCommentsPanel({
  state,
  openImports,
  reportError,
}: {
  state: ToolState;
  openImports: () => void;
  reportError: (error: string) => void;
}) {
  const cases = useMemo(
    () =>
      buildOpenCommentCases({ catalog: state.catalog, comments: state.comments.at(-1) ?? null }),
    [state],
  );
  const [query, setQuery] = useState(''),
    [owner, setOwner] = useState(''),
    [party, setParty] = useState('');
  const [scope, setScope] = useState('catalog'),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [threadId, setThreadId] = useState<string | null>(null),
    [exportKind, setExportKind] = useState<'summary' | 'drawings' | null>(null);
  const [overrides, setOverrides] = useState<Record<string, DrawingExportOverride>>({}),
    [exportBusy, setExportBusy] = useState(false);
  const source = state.comments.at(-1)?.source;
  const scopeCases = cases.filter(
    (c) =>
      !state.catalog || scope === 'all' || (scope === 'unmatched' ? !c.inCatalog : c.inCatalog),
  );
  const rows = scopeCases.filter(
    (c) =>
      (!party || c.party === party) &&
      (!owner || c.drawings.some((d) => (d.owner || '负责人待补') === owner)) &&
      (!query.trim() ||
        [
          c.parent.messageId,
          c.parent.title,
          c.parent.description,
          ...c.drawings.flatMap((d) => [d.drawingNo, d.cn, d.en, d.owner]),
          ...c.latestYardRound.map(messageText),
          ...c.latestDnvRound.map(messageText),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const target = rows.filter((c) => selected.has(c.key));
  const exportRows = target.length ? target : rows;
  const thread = cases.find((c) => c.key === threadId);
  const groups = exportDrawingGroups(exportRows, overrides);
  const changeFilters = () => {
    setPage(0);
    setSelected(new Set());
  };
  const context: OpinionExportContext = {
    projectName: state.project?.name || '未命名项目',
    projectId: state.project?.projectId || '',
    sourceFilename: source?.filename || '',
    sourceDate: source?.dataDate ?? null,
    sourceComplete: Boolean(source && isFull(source)),
    exportedAt: localStamp(new Date().toISOString()),
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>未闭环意见</h1>
          <span className="muted">看清主意见与当前往来，确认下一步该谁处理</span>
        </div>
        <button onClick={openImports}>
          <Upload size={16} />
          导入 / 更新资料
        </button>
      </div>
      {!source ? (
        <div className="empty-state">
          <MessageSquare size={36} />
          <h3>先导入 Comments，开始整理未闭环意见</h3>
          <p>台账补充图名和负责人，Documents补充图纸状态。仅有Comments也可以先查看。</p>
          <button className="primary" onClick={openImports}>
            导入资料
          </button>
        </div>
      ) : (
        <>
          <div className="opinion-source">
            <span>
              来源：{source.filename} · 资料日期 {source.dataDate || '未提供'}
            </span>
            {!isFull(source) && <Badge text="所导出范围，完整性待确认" tone="amber" />}
            {!state.catalog && <Badge text="未关联台账，当前为项目导出范围" tone="amber" />}
          </div>
          <div className="opinion-tabs">
            <button
              className={!party ? 'active' : ''}
              onClick={() => {
                setParty('');
                changeFilters();
              }}
            >
              未闭环 <b>{scopeCases.length}</b>
            </button>
            {(Object.keys(partyLabels) as ActionParty[]).map((p) => (
              <button
                key={p}
                className={party === p ? 'active' : ''}
                onClick={() => {
                  setParty(p);
                  changeFilters();
                }}
              >
                {partyLabels[p]} <b>{scopeCases.filter((c) => c.party === p).length}</b>
              </button>
            ))}
          </div>
          <div className="filters">
            <input
              aria-label="搜索未闭环意见"
              placeholder="图号、图名、意见编号或内容"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                changeFilters();
              }}
            />
            <select
              aria-label="意见负责人"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                changeFilters();
              }}
            >
              <option value="">全部负责人</option>
              {[
                ...new Set(
                  scopeCases.flatMap((c) => c.drawings.map((d) => d.owner || '负责人待补')),
                ),
              ]
                .sort((a, b) => a.localeCompare(b, 'zh-CN'))
                .map((o) => (
                  <option key={o}>{o}</option>
                ))}
            </select>
            {state.catalog && (
              <select
                aria-label="意见范围"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  changeFilters();
                }}
              >
                <option value="catalog">本台账关联意见</option>
                <option value="unmatched">
                  未匹配台账（{cases.filter((c) => !c.inCatalog).length}）
                </option>
                <option value="all">全部导出项目意见</option>
              </select>
            )}
            <button
              onClick={() => {
                setOwner('');
                setQuery('');
                setParty('');
                changeFilters();
              }}
            >
              清除筛选
            </button>
          </div>
          <div className="opinion-toolbar">
            <span>
              当前 {rows.length} 条主意见 · 已选 {target.length} 条{' '}
              <small>跨图纸同一主意见只计一次；导出默认使用当前筛选，勾选后只导出所选项。</small>
            </span>
            <div className="row-actions">
              <button
                disabled={!rows.length}
                onClick={() => {
                  setOverrides({});
                  setExportKind('summary');
                }}
              >
                <Download size={16} />
                汇总Excel
              </button>
              <button
                disabled={!rows.length}
                onClick={() => {
                  setOverrides({});
                  setExportKind('drawings');
                }}
              >
                <Download size={16} />
                每图回复表
              </button>
            </div>
          </div>
          {(state.comments.at(-1)?.data.orphanMessageIds.length ?? 0) > 0 && (
            <p className="notice">
              导出中另有 {state.comments.at(-1)!.data.orphanMessageIds.length}{' '}
              条缺少主意见关联或类型不明的消息，无法归入正常主意见清单，请在辅助工具核对来源。
            </p>
          )}
          <label className="opinion-select-all">
            <input
              type="checkbox"
              aria-label="选择当前筛选的全部意见"
              checked={rows.length > 0 && target.length === rows.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(rows.map((c) => c.key)) : new Set())
              }
            />
            选择当前筛选的全部意见
          </label>
          <div className="opinion-list">
            {rows.slice(page * 15, (page + 1) * 15).map((c) => (
              <article className="opinion-case" key={c.key}>
                <div className="opinion-case-head">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${c.parent.messageId}`}
                      checked={selected.has(c.key)}
                      onChange={(e) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          e.target.checked ? next.add(c.key) : next.delete(c.key);
                          return next;
                        })
                      }
                    />
                    <strong>{c.parent.messageId}</strong>
                  </label>
                  <span className="muted">{c.parent.type || '未提供意见类型'}</span>
                  <Badge
                    text={partyLabels[c.party]}
                    tone={c.party === 'confirm' ? 'amber' : c.party === 'dnv' ? 'blue' : 'neutral'}
                  />
                  <button className="thread-button" onClick={() => setThreadId(c.key)}>
                    完整往来（{c.thread.length}）<ChevronDown size={14} />
                  </button>
                </div>
                <div className="opinion-drawings">
                  {c.drawings.length ? (
                    c.drawings.map((d) => (
                      <span key={d.drawingNo}>
                        <code>{d.drawingNo}</code> {d.cn || d.en || '图名待补'}{' '}
                        <b>{d.owner || '负责人待补'}</b>
                        {!d.matched && <small>未匹配台账</small>}
                      </span>
                    ))
                  ) : (
                    <span>未关联图纸，请核对原始导出</span>
                  )}
                </div>
                <div className="opinion-columns">
                  <section>
                    <h3>主意见</h3>
                    <ReadableText
                      text={[c.parent.title, c.parent.description].filter(Boolean).join('\n')}
                    />
                    <small>提出日期 {stamp(c.parent.issueDate.iso)}</small>
                  </section>
                  <section className="yard">
                    <h3>我方最近一轮</h3>
                    <Round messages={c.latestYardRound} empty="暂无船厂回复" />
                  </section>
                  <section>
                    <h3>船检最近一轮</h3>
                    <Round messages={c.latestDnvRound} empty="暂无船检后续回复" />
                  </section>
                </div>
                <div className="opinion-case-foot">
                  <span>
                    当前回方：<b>{partyLabels[c.party]}</b> · {c.systemRole || '系统未提供责任方'}
                    <small>
                      {c.reason}；最近活动 {stamp(c.latestActivity)}
                    </small>
                  </span>
                  {c.warnings.length > 0 && (
                    <details>
                      <summary>核对提示（{c.warnings.length}）</summary>
                      {c.warnings.map((w) => (
                        <p key={w}>{w}</p>
                      ))}
                    </details>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!rows.length && (
            <div className="empty-state">
              <h3>当前范围没有未闭环主意见</h3>
              <p>这只代表已导入的记录；资料范围未确认完整时，不能据此认定全部闭环。</p>
            </div>
          )}
          <Pager total={rows.length} page={page} size={15} setPage={setPage} />
        </>
      )}
      {thread && (
        <Modal title={`${thread.parent.messageId} · 完整往来`} close={() => setThreadId(null)} wide>
          <p>
            {partyLabels[thread.party]} · {thread.reason}
          </p>
          {thread.warnings.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          <div className="thread">
            {thread.thread.map((m) => (
              <article
                className={`message ${m.issuedByRole.startsWith('Yard') ? 'yard' : 'dnv'}`}
                key={m.messageId}
              >
                <Badge text={m.kind === 'parent' ? '主意见' : '子意见 / 回复'} tone="neutral" />
                <p className="body-text">{messageText(m)}</p>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {exportKind && (
        <Modal
          title={exportKind === 'summary' ? '导出汇总Excel' : '导出每图回复表'}
          close={() => !exportBusy && setExportKind(null)}
          wide
        >
          <p>
            本次导出 <b>{exportRows.length}</b> 条主意见，涉及 <b>{groups.length}</b> 张图纸。
            {target.length ? '使用已勾选意见。' : '使用当前筛选范围。'}
          </p>
          <p className="notice">
            {exportKind === 'summary'
              ? '汇总表按负责人和台账顺序排列，保留主意见和双方最近一轮；长正文续行完整保留。'
              : '每图一份Excel，保留全部已导入往来及下一轮待填位置。'}{' '}
            已设置列宽、换行、行高、冻结表头及A3横向打印。来源未确认完整时，导出同时注明。
          </p>
          {exportKind === 'drawings' && (
            <>
              <p>核对中文图名与负责人，修改只影响本次文件命名和表头。</p>
              <div className="table-scroll export-name-review">
                <table>
                  <thead>
                    <tr>
                      <th>图号</th>
                      <th>中文图名</th>
                      <th>负责人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(({ drawing: d }) => (
                      <tr key={d.drawingNo}>
                        <td>
                          <code>{d.drawingNo}</code>
                        </td>
                        <td>
                          <input
                            aria-label={`导出图名 ${d.drawingNo}`}
                            placeholder="图名待补"
                            value={d.cn || d.en}
                            onChange={(e) =>
                              setOverrides((old) => ({
                                ...old,
                                [d.drawingNo]: { cn: e.target.value, owner: d.owner },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`导出负责人 ${d.drawingNo}`}
                            placeholder="负责人待补"
                            value={d.owner}
                            onChange={(e) =>
                              setOverrides((old) => ({
                                ...old,
                                [d.drawingNo]: { cn: d.cn || d.en, owner: e.target.value },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {exportRows.some((c) => !c.drawings.length) && (
                <p className="notice">
                  没有关联图纸的意见会另附“待匹配图纸的意见.xlsx”，不会丢弃。
                </p>
              )}
            </>
          )}
          <div className="modal-actions">
            <button disabled={exportBusy} onClick={() => setExportKind(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={exportBusy || !exportRows.length}
              onClick={async () => {
                setExportBusy(true);
                try {
                  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  const bytes =
                    exportKind === 'summary'
                      ? exportOpenCases(exportRows, context)
                      : exportDrawingReplyPackage(exportRows, context, overrides);
                  download(
                    bytes,
                    `DNV未闭环${exportKind === 'summary' ? '意见清单' : '回复表'}_${localDay()}.${exportKind === 'summary' ? 'xlsx' : 'zip'}`,
                    exportKind === 'summary'
                      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      : 'application/zip',
                  );
                  setExportKind(null);
                } catch (e) {
                  reportError(String(e));
                } finally {
                  setExportBusy(false);
                }
              }}
            >
              {exportBusy ? '正在生成…' : '确认导出'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Round({ messages, empty }: { messages: OpenCommentCase['thread']; empty: string }) {
  return messages.length ? (
    <>
      {messages.map((m) => (
        <div className="round-message" key={m.messageId}>
          <ReadableText text={messageText(m)} />
        </div>
      ))}
    </>
  ) : (
    <p className="muted">{empty}</p>
  );
}

function ReadableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 650 || text.split('\n').length > 12;
  return (
    <>
      <p className={`opinion-text ${long && !expanded ? 'collapsed-text' : ''}`}>{text}</p>
      {long && (
        <button className="text-expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起正文' : '展开全文'}
        </button>
      )}
    </>
  );
}
