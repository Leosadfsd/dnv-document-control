import { useMemo, useState } from 'react';
import { Download, Filter, Settings } from 'lucide-react';
import type { ToolState } from '../domain/model';
import {
  buildStatistics,
  linkedRows,
  matchesMetric,
  metricLabels,
  stageLabels,
  type DrawingMetric,
} from '../domain/statistics';
import { statisticsPackage } from '../data/statistics-export';
import { download } from '../data/ledger-export';
import { Badge, date, localDay, Modal, Pager, roleLabel } from './components';

export function StatisticsPanel({
  state,
  ready,
  openDrawing,
  openImports,
  saveExclusions,
  reportError,
}: {
  state: ToolState;
  ready: boolean;
  openDrawing: (no: string) => void;
  openImports: () => void;
  saveExclusions: (ids: string[]) => Promise<void>;
  reportError: (error: string) => void;
}) {
  const stats = useMemo(() => buildStatistics(state), [state]);
  const [metric, setMetric] = useState<DrawingMetric>('required');
  const [mode, setMode] = useState<'drawings' | 'comments'>('drawings');
  const [opinionStatus, setOpinionStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [approval, setApproval] = useState('');
  const [page, setPage] = useState(0);
  const [scope, setScope] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [saving, setSaving] = useState(false);
  const filtered = stats.rows.filter(
    (r) =>
      (mode === 'comments' || matchesMetric(r, metric)) &&
      (!owner || (r.summary.owner || '未分配') === owner) &&
      (!approval || r.document?.approvalStatus === approval) &&
      (!query.trim() ||
        [r.summary.drawingNo, r.summary.cn, r.summary.en, r.summary.owner]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const nos = new Set(filtered.map((r) => r.summary.drawingNo));
  const parents = stats.parents.filter(
    (p) =>
      (!opinionStatus ||
        (opinionStatus === 'other'
          ? !['Open', 'Closed'].includes(p.status)
          : p.status === opinionStatus)) &&
      (!role || (p.status === 'Open' && (p.actionNeededBy || '未指定') === role)) &&
      p.links.some((l) => nos.has(l.drawingNo)),
  );
  const chooseMetric = (key: DrawingMetric) => {
    setOwner('');
    setQuery('');
    setApproval('');
    setRole('');
    setMetric(key);
    setMode('drawings');
    setPage(0);
  };
  const chooseOpinions = (status: string, currentRole = '') => {
    setOwner('');
    setQuery('');
    setApproval('');
    setOpinionStatus(status);
    setRole(currentRole);
    setMode('comments');
    setPage(0);
  };
  const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
  const show = (value: number, available: boolean) => (available ? value : '—');
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>船检统计</h1>
          <span className="muted">送审、返回与闭环 · 点击数字查看对应明细</span>
        </div>
        <button
          disabled={!state.catalog || !ready}
          onClick={() => {
            try {
              download(
                statisticsPackage(state, stats),
                `DNV统计_${localDay()}.zip`,
                'application/zip',
              );
            } catch (e) {
              reportError(String(e));
            }
          }}
        >
          <Download size={17} />
          导出统计包
        </button>
      </div>
      {!state.catalog ? (
        <div className="empty-state">
          <h3>先导入文控台账，确定应送范围</h3>
          <p>随后导入 Documents 和全部状态的 Comments，计算图纸与意见统计。</p>
          <button className="primary" onClick={openImports}>
            导入资料
          </button>
        </div>
      ) : (
        <>
          <div className="statistics-scope">
            <span>
              <Filter size={15} />
              台账DNV勾选 {stats.metrics.required + stats.excluded} 张 · 排除 {stats.excluded} 张 ·
              本次 {stats.metrics.required} 张
            </span>
            <button
              onClick={() => {
                setScope((state.catalog?.statistics?.excludedDrawingNos ?? []).join('\n'));
                setScopeError('');
              }}
            >
              <Settings size={15} />
              统计范围
            </button>
          </div>
          <div className="source-dates">
            <span>Documents资料日期 {date(state.documents.at(-1)?.source.dataDate)}</span>
            <span>Comments资料日期 {date(state.comments.at(-1)?.source.dataDate)}</span>
          </div>
          {(!stats.complete.documents || !stats.complete.comments) && (
            <div className="statistics-warning">
              <strong>当前为暂定统计</strong>
              <span>
                {!stats.available.documents
                  ? 'Documents未导入。'
                  : !stats.complete.documents
                    ? 'Documents范围未确认完整。'
                    : ''}{' '}
                {!stats.available.comments
                  ? 'Comments未导入。'
                  : !stats.complete.comments
                    ? 'Comments范围未确认完整，意见数仅代表已导入数据。'
                    : ''}{' '}
                完整性确认前，不将零Open自动认定为闭环。
              </span>
              <button onClick={openImports}>核对导入范围</button>
            </div>
          )}
          {stats.unconfirmedDnv > 0 && (
            <p className="warning">另有 {stats.unconfirmedDnv} 张DNV标记待确认，暂未计入应送。</p>
          )}
          <section className="statistics-card">
            <div className="section-heading">
              <h2>图纸送审与返回</h2>
              <small>最新送审对应结果，历史返回单独保留</small>
            </div>
            <div className="statistics-grid">
              {(['required', 'sent', 'unsent', 'returned', 'awaiting'] as const).map((key) => (
                <button
                  key={key}
                  disabled={key !== 'required' && !stats.available.documents}
                  className={mode === 'drawings' && metric === key ? 'active' : ''}
                  onClick={() => chooseMetric(key)}
                >
                  <span>{metricLabels[key]}</span>
                  <strong>
                    {show(stats.metrics[key], key === 'required' || stats.available.documents)}
                  </strong>
                  <small>
                    {key === 'unsent'
                      ? '不代表实际从未送审'
                      : key === 'returned'
                        ? '含批复代码等返回证据'
                        : '张图纸'}
                  </small>
                </button>
              ))}
            </div>
            <div className="statistics-rates">
              <span>
                送审率 <b>{stats.available.documents ? percent(stats.rates.sent) : '—'}</b>
                <small>已送审 ÷ 应送</small>
              </span>
              <span>
                退审率 <b>{stats.available.documents ? percent(stats.rates.returned) : '—'}</b>
                <small>已返回 ÷ 已送审</small>
              </span>
              <span>
                图纸闭环率{' '}
                <b>
                  {stats.available.documents && stats.available.comments
                    ? percent(stats.rates.closed)
                    : '—'}
                </b>
                <small>已闭环 ÷ 已返回</small>
              </span>
            </div>
          </section>
          <div className="statistics-pair">
            <section className="statistics-card">
              <h2>已返回图纸的闭环情况</h2>
              <p className="muted">四类合计等于已返回图纸数。FI/DI无Open时单列。</p>
              <div className="statistics-grid compact">
                {(['closed', 'open', 'not-applicable', 'uncertain'] as const).map((key) => (
                  <button
                    disabled={!stats.available.documents}
                    key={key}
                    className={mode === 'drawings' && metric === key ? 'active' : ''}
                    onClick={() => chooseMetric(key)}
                  >
                    <span>{metricLabels[key]}</span>
                    <strong>{show(stats.metrics[key], stats.available.documents)}</strong>
                  </button>
                ))}
              </div>
            </section>
            <section className="statistics-card">
              <h2>船检父意见关闭情况</h2>
              <p className="muted">跨图纸关联去重，回复不重复计数。</p>
              <div className="statistics-grid compact">
                {(
                  [
                    ['', 'total', '父意见总数'],
                    ['Open', 'open', '未关闭'],
                    ['Closed', 'closed', '已关闭'],
                    ['other', 'other', '其他状态'],
                  ] as const
                ).map(([status, key, label]) => (
                  <button
                    disabled={!stats.available.comments}
                    key={key}
                    className={
                      mode === 'comments' && opinionStatus === status && !role ? 'active' : ''
                    }
                    onClick={() => chooseOpinions(status)}
                  >
                    <span>{label}</span>
                    <strong>{show(stats.comments[key], stats.available.comments)}</strong>
                  </button>
                ))}
              </div>
              <p>
                意见关闭率 <b>{stats.available.comments ? percent(stats.rates.comments) : '—'}</b>{' '}
                <span className="muted">已关闭 ÷ 父意见总数</span>
              </p>
            </section>
          </div>
          <section className="statistics-card">
            <h2>批复代码与当前处理方</h2>
            <div className="statistics-breakdowns">
              <div>
                <h3>已返回图纸的批复代码</h3>
                <div className="row-actions">
                  {Object.entries(stats.approvalCodes).map(([code, count]) => (
                    <button
                      key={code}
                      onClick={() => {
                        chooseMetric('returned');
                        setApproval(code === '未提供代码' ? '' : code);
                      }}
                    >
                      {code} <b>{count}</b>
                    </button>
                  ))}
                  {!Object.keys(stats.approvalCodes).length && (
                    <span className="muted">暂无返回记录</span>
                  )}
                </div>
              </div>
              <div>
                <h3>Open意见的当前责任方</h3>
                <div className="row-actions">
                  {Object.entries(stats.roles).map(([r, count]) => (
                    <button key={r} onClick={() => chooseOpinions('Open', r)}>
                      {roleLabel(r)} <b>{count}</b>
                    </button>
                  ))}
                  {!Object.keys(stats.roles).length && (
                    <span className="muted">暂无Open责任方数据</span>
                  )}
                </div>
                <small>当前责任方不等于从未回复，具体以往来记录为准。</small>
              </div>
            </div>
          </section>
          <section className="statistics-card" id="statistics-detail">
            <div className="section-heading">
              <div>
                <h2>{mode === 'drawings' ? `${metricLabels[metric]} · 图纸明细` : '父意见明细'}</h2>
                <small>保持台账原顺序 · 导出统计包包含完整统计范围，下面筛选仅用于查看</small>
              </div>
            </div>
            <div className="filters">
              <input
                aria-label="统计搜索"
                placeholder="图号、图名或负责人"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
              <select
                aria-label="统计负责人"
                value={owner}
                onChange={(e) => {
                  setOwner(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">全部负责人</option>
                {[...new Set(stats.rows.map((r) => r.summary.owner || '未分配'))]
                  .sort((a, b) => a.localeCompare(b, 'zh-CN'))
                  .map((o) => (
                    <option key={o}>{o}</option>
                  ))}
              </select>
              <select
                aria-label="统计批复代码"
                value={approval}
                onChange={(e) => {
                  setApproval(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">全部批复代码</option>
                {Object.keys(stats.approvalCodes)
                  .filter((c) => c !== '未提供代码')
                  .map((c) => (
                    <option key={c}>{c}</option>
                  ))}
              </select>
              {mode === 'comments' && (
                <>
                  <select
                    aria-label="统计意见状态"
                    value={opinionStatus}
                    onChange={(e) => {
                      setOpinionStatus(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">全部意见状态</option>
                    <option>Open</option>
                    <option>Closed</option>
                    <option value="other">其他状态</option>
                  </select>
                  <select
                    aria-label="统计Open责任方"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">全部Open责任方</option>
                    {Object.keys(stats.roles).map((r) => (
                      <option value={r} key={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                onClick={() => {
                  setOwner('');
                  setQuery('');
                  setApproval('');
                  setRole('');
                  setOpinionStatus('');
                  setPage(0);
                }}
              >
                清除筛选
              </button>
            </div>
            <div className="table-scroll">
              <table className="statistics-table">
                <thead>
                  <tr>
                    {(mode === 'drawings'
                      ? [
                          '序号',
                          '图号 / 图名',
                          '负责人',
                          '送审',
                          '版本',
                          '送审日期',
                          '返回日期',
                          '批复代码',
                          '闭环分类',
                          'Open / Closed',
                          '数据提示',
                        ]
                      : [
                          'Comment ID',
                          '关联图纸 / 负责人',
                          '状态',
                          '类型',
                          '当前责任方',
                          '意见标题 / 内容',
                          '最后活动',
                        ]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mode === 'drawings'
                    ? filtered.slice(page * 30, (page + 1) * 30).map((r) => (
                        <tr key={r.summary.drawingNo}>
                          <td>{r.summary.sequence}</td>
                          <td>
                            <button
                              className="drawing-link"
                              onClick={() => openDrawing(r.summary.drawingNo)}
                            >
                              <code>{r.summary.drawingNo}</code>
                              <strong>{r.summary.cn || r.summary.en}</strong>
                            </button>
                          </td>
                          <td>{r.summary.owner || '未分配'}</td>
                          <td>
                            {!stats.available.documents
                              ? '未导入'
                              : r.sent
                                ? '已送审'
                                : '无有效记录'}
                          </td>
                          <td>{r.document?.revision || '—'}</td>
                          <td>{date(r.document?.sent.iso)}</td>
                          <td>{date(r.document?.received.iso)}</td>
                          <td>
                            <Badge text={r.document?.approvalStatus || '—'} tone="blue" />
                          </td>
                          <td>{r.returned ? stageLabels[r.stage] : '—'}</td>
                          <td>
                            {stats.available.comments
                              ? `${r.summary.openCount} / ${r.summary.closedCount}`
                              : '未导入'}
                          </td>
                          <td className="statistics-note">{r.summary.note || '—'}</td>
                        </tr>
                      ))
                    : parents.slice(page * 30, (page + 1) * 30).map((p) => (
                        <tr key={p.messageId}>
                          <td>
                            <code>{p.messageId}</code>
                          </td>
                          <td>
                            {linkedRows(p, stats.rows).map((r) => (
                              <div key={r.summary.drawingNo}>
                                <button
                                  className="drawing-link"
                                  onClick={() => openDrawing(r.summary.drawingNo)}
                                >
                                  {r.summary.drawingNo}
                                </button>
                                <small>{r.summary.owner || '未分配'}</small>
                              </div>
                            ))}
                          </td>
                          <td>
                            <Badge
                              text={p.status || '未提供'}
                              tone={
                                p.status === 'Open'
                                  ? 'amber'
                                  : p.status === 'Closed'
                                    ? 'green'
                                    : 'neutral'
                              }
                            />
                          </td>
                          <td>{p.type}</td>
                          <td>{roleLabel(p.actionNeededBy) || '未指定'}</td>
                          <td className="statistics-opinion">
                            <strong>{p.title}</strong>
                            <p>{p.description}</p>
                          </td>
                          <td>{date(p.lastActivity.iso)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {!(mode === 'drawings' ? filtered.length : parents.length) && (
                <p className="empty">当前范围没有匹配记录</p>
              )}
            </div>
            <Pager
              total={mode === 'drawings' ? filtered.length : parents.length}
              page={page}
              size={30}
              setPage={setPage}
            />
          </section>
          <details className="statistics-card statistics-method">
            <summary>查看统计口径</summary>
            <p>
              应送依据台账DNV明确勾选，安全返港等排除按人工图号清单。已送依据Sent
              Date或Sent/Received状态；已返回依据最新送审记录的Received
              Date、批复代码或Received状态。“退审”表示返回处理结果，并不等于拒绝批准。
            </p>
            <p>
              闭环需完整Documents及全部状态Comments、无缺失记录、无其他状态意见、Documents没有矛盾Open数；AP或AC且所有父意见Closed才认定，AP无父意见也可计闭环。FI/DI无Open时列不适用；其他不确定情况待确认。新版本待返回时不借用旧版本结果判定。
            </p>
            <p>
              父意见按项目号与Comment
              ID去重，跨图纸同一意见只计一次。总数=Open+Closed+其他状态。分负责人查看时，同一跨负责人意见可能同时出现在多人的列表，不能直接把各人数字相加作项目总数。缺失、未导入不当作零或关闭。统计不证明已向工程师分发。
            </p>
            <p>
              统计包含总览、图纸明细、父意见明细CSV和口径TXT；CSV可用Excel/WPS打开。原格式台账仍用页首“导出台账”。
            </p>
          </details>
        </>
      )}
      {scope !== null && (
        <Modal title="统计范围 · 排除图号" close={() => !saving && setScope(null)}>
          <p>
            需要排除安全返港等图纸时，填写确认过的图号，每行一个。不凭图名自动识别；不填写即包含全部DNV勾选图纸。只影响统计，不删除数据。
          </p>
          <textarea
            className="scope-drawings"
            aria-label="统计排除图号"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={8}
          />
          {scopeError && <p className="error">{scopeError}</p>}
          <div className="modal-actions">
            <button disabled={saving} onClick={() => setScope(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                const ids = [
                  ...new Set(
                    scope
                      .toUpperCase()
                      .split(/[\s,，;；、]+/)
                      .filter(Boolean),
                  ),
                ];
                const known = new Set(state.catalog!.catalog.drawings.map((d) => d.drawingNo));
                const unknown = ids.filter((no) => !known.has(no));
                if (unknown.length) {
                  setScopeError(`台账中未找到：${unknown.join('、')}`);
                  return;
                }
                setSaving(true);
                try {
                  await saveExclusions(ids);
                  setScope(null);
                } catch (e) {
                  setScopeError(String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              保存统计范围
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
