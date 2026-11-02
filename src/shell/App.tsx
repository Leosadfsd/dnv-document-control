import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  FileText,
  History,
  Database,
  Settings,
  Download,
  Upload,
  Search,
  FolderInput,
  Files,
  RotateCcw,
  ShieldCheck,
  X,
  ChevronRight,
  AlertTriangle,
  Menu,
  BarChart3,
} from 'lucide-react';
import type { SourceMeta, Comparison, ProjectSettings } from '../domain/contracts';
import type { ToolState, Summary, PreparedImport, InputKind } from '../domain/model';
import { emptyState } from '../domain/model';
import { applyImport, undoImport, isFull, buildDrawingSummaries } from '../domain/derive';
import { loadState, saveState, exportBackup, validateBackup } from '../data/storage';
import { runWorker } from '../data/worker-client';
import { sourceDateFromFilename } from '../domain/parse';
import { exportLedger, download } from '../data/ledger-export';
import { ledgerFields, ledgerValues } from '../domain/ledger-fields';
import { Detail } from './Detail';
import { ImportPreview } from './ImportPreview';
import { StatisticsPanel } from './StatisticsPanel';
import {
  Modal,
  FileInput,
  Pager,
  Badge,
  date,
  localStamp as stamp,
  localDay,
  roleLabel,
  stateLabel,
  kindLabel,
} from './components';
const Letters = lazy(() => import('./LetterPanel').then((m) => ({ default: m.LetterPanel })));
type Page = 'statistics' | 'drawings' | 'changes' | 'imports' | 'letters' | 'data';
interface DerivedData {
  summaries: Summary[];
  documentChanges: Comparison | null;
  commentChanges: Comparison | null;
}
const nav = [
  { id: 'statistics', label: '船检统计', icon: BarChart3 },
  { id: 'drawings', label: '图纸清单', icon: FileText },
  { id: 'changes', label: '本次变化', icon: History },
  { id: 'imports', label: '资料导入', icon: FolderInput },
  { id: 'letters', label: 'Letter处理', icon: Files },
  { id: 'data', label: '数据管理', icon: Database },
] as const;
const inputNames: Record<InputKind, string> = {
  catalog: '文控台账',
  documents: 'Documents',
  comments: 'Comments',
};
const newSource = (kind: InputKind, filename: string, fingerprint: string): SourceMeta => ({
  kind,
  filename,
  fingerprint,
  importedAt: new Date().toISOString(),
  dataDate: sourceDateFromFilename(filename),
  scope: {
    project: 'unconfirmed',
    revisions: 'unconfirmed',
    statuses: 'unconfirmed',
    confirmedByUser: false,
  },
});
async function fingerprint(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function App() {
  const [state, setState] = useState<ToolState>(emptyState),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState<Page>('statistics');
  const [derived, setDerived] = useState<DerivedData>({
    summaries: [],
    documentChanges: null,
    commentChanges: null,
  });
  const [derivedFor, setDerivedFor] = useState<ToolState | null>(null);
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [projectModal, setProjectModal] = useState(false),
    [menu, setMenu] = useState(false);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [exportModal, setExportModal] = useState(false),
    [restore, setRestore] = useState<ToolState | null>(null);
  const [query, setQuery] = useState(''),
    [owner, setOwner] = useState(''),
    [department, setDepartment] = useState(''),
    [status, setStatus] = useState(''),
    [approval, setApproval] = useState(''),
    [role, setRole] = useState(''),
    [order, setOrder] = useState('sequence'),
    [listPage, setListPage] = useState(0);
  const abort = useRef<AbortController | null>(null),
    booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadState()
      .then((s) => {
        setState(s);
        setLoaded(true);
      })
      .catch((e) => {
        setError(String(e));
        setLoaded(true);
      });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    runWorker<DerivedData>(
      'derive',
      { ...state, template: null, undo: {}, operations: [] },
      controller.signal,
    )
      .then((result) => {
        setDerived(result);
        setDerivedFor(state);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [state, loaded]);
  useEffect(() => setListPage(0), [query, owner, department, status, approval, role, order]);
  const commit = async (next: ToolState, only?: InputKind) => {
    const revision = await saveState({ ...next, revision: state.revision }, only);
    setState({ ...next, revision });
  };
  async function prepare(file: File, kind: InputKind) {
    if (!state.project) {
      setProjectModal(true);
      setNotice('请先确认项目，再上传文件');
      return;
    }
    setError('');
    setBusy(`正在读取 ${file.name}`);
    abort.current = new AbortController();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过20 MB限制');
      if (!/\.xlsx$/i.test(file.name)) throw new Error('请上传.xlsx文件');
      const match = /^D(\d+)_/i.exec(file.name);
      if (kind !== 'catalog' && match && match[1] !== state.project.projectId)
        throw new Error('文件项目号与当前项目不一致');
      const buffer = await file.arrayBuffer(),
        source = newSource(kind, file.name, await fingerprint(buffer));
      const result = await runWorker<PreparedImport>(
        'prepare',
        { buffer, kind, context: { project: state.project, source } },
        abort.current.signal,
      );
      setPrepared(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
      abort.current = null;
    }
  }
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = derived.summaries.filter(
      (s) =>
        (!q || [s.drawingNo, s.cn, s.en, s.owner].join(' ').toLowerCase().includes(q)) &&
        (!owner || s.owner === owner) &&
        (!department || s.department === department) &&
        (!approval || s.currentDocument?.approvalStatus === approval) &&
        (!role || Boolean(s.openByRole[role])) &&
        (!status ||
          (status === 'open' && s.openCount > 0) ||
          (status === 'yard' && s.candidateYardDesignCount > 0) ||
          (status === 'sent' && s.currentDocument?.status === 'Sent') ||
          (status === 'received' && s.currentDocument?.status === 'Received') ||
          (status === 'nodate' && s.documentAvailability === 'no-valid-sent') ||
          (status === 'issue' && Boolean(s.note))),
    );
    return order === 'owner'
      ? [...rows].sort((a, b) => a.owner.localeCompare(b.owner, 'zh-CN') || a.sequence - b.sequence)
      : rows;
  }, [derived.summaries, query, owner, department, status, approval, role, order]);
  const unique = (values: string[]) =>
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const detail = useMemo(
    () =>
      derived.summaries.find((s) => s.drawingNo === selected) ??
      (selected && state.catalog
        ? buildDrawingSummaries(
            { ...state.catalog, followed: [selected] },
            state.documents.at(-1) ?? null,
            state.comments.at(-1) ?? null,
          )[0]
        : undefined),
    [selected, derived, state],
  );
  const totals = {
    all: derived.summaries.length,
    sent: derived.summaries.filter((s) => s.currentDocument?.status === 'Sent').length,
    open: derived.summaries.filter((s) => s.openCount > 0).length,
    yard: derived.summaries.filter((s) => s.candidateYardDesignCount > 0).length,
    missing: derived.summaries.filter((s) => s.documentAvailability === 'no-valid-sent').length,
  };
  const sources = {
    catalog: state.catalog?.catalog.source,
    documents: state.documents.at(-1)?.source,
    comments: state.comments.at(-1)?.source,
  };
  async function updateOverride(no: string, cn: string, owner: string) {
    if (!state.catalog) return;
    const next = structuredClone(state);
    next.catalog!.overrides[no] = { ...next.catalog!.overrides[no], cn, owner };
    await commit(next, 'catalog');
    setNotice('基础资料修正已保存');
  }
  return (
    <div className="app">
      <aside className={menu ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <FileText size={25} />
          <div>
            <strong>DNV 图纸查询</strong>
            <small>文控工作台</small>
          </div>
        </div>
        <nav aria-label="主导航">
          {nav.map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => {
                setPage(item.id);
                setMenu(false);
              }}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === 'drawings' && <span>{totals.all || '—'}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          本机数据 <small>0.3.1</small>
        </div>
      </aside>
      {menu && (
        <button className="menu-shade" aria-label="收起导航" onClick={() => setMenu(false)} />
      )}
      <div className="workspace">
        <header>
          <button
            className="icon mobile-menu"
            aria-label="导航"
            title="导航"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <div className="project-title">
            <strong>{state.project?.name || '未选择项目'}</strong>
            <small>{state.project ? `DNV ${state.project.projectId}` : '本地工作区'}</small>
          </div>
          <div className="header-actions">
            <button
              disabled={!state.template || Boolean(busy) || derivedFor !== state}
              aria-label="导出台账"
              title="导出台账"
              onClick={() => setExportModal(true)}
            >
              <Download size={17} />
              <span>导出台账</span>
            </button>
            <button
              className="icon"
              title="项目设置"
              aria-label="项目设置"
              onClick={() => setProjectModal(true)}
            >
              <Settings size={19} />
            </button>
          </div>
        </header>
        <main>
          {notice && (
            <div className="flash">
              <ShieldCheck size={17} />
              <span>{notice}</span>
              <button className="icon" title="关闭提示" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {error && (
            <div className="flash error">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button className="icon" title="关闭错误" onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {busy && (
            <div className="flash busy" role="status">
              <span className="spinner" />
              <span>{busy}</span>
              <button onClick={() => abort.current?.abort()}>取消</button>
            </div>
          )}
          {loaded && derivedFor !== state && (
            <div className="flash busy" role="status">
              <span className="spinner" />
              <span>正在整理查询数据…</span>
            </div>
          )}
          {page === 'drawings' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>图纸清单</h1>
                  <span className="muted">
                    {state.catalog
                      ? `${state.catalog.followed.length} 张关注图纸 · ${state.catalog.catalog.drawings.length} 张基础图纸`
                      : '暂无基础资料'}
                  </span>
                </div>
                <button onClick={() => setPage('imports')}>
                  <Upload size={17} />
                  导入资料
                </button>
              </div>
              <div className="metrics">
                {[
                  { label: '全部图纸', value: totals.all, filter: '' },
                  { label: '已送审待处理', value: totals.sent, filter: 'sent' },
                  { label: '存在Open意见', value: totals.open, filter: 'open' },
                  { label: '设计侧Open', value: totals.yard, filter: 'yard' },
                  { label: '无有效送审日期', value: totals.missing, filter: 'nodate' },
                ].map((m) => (
                  <button
                    className={status === m.filter ? 'active' : ''}
                    key={m.label}
                    onClick={() => setStatus(m.filter)}
                  >
                    <span>{m.label}</span>
                    <strong>{state.catalog ? m.value : '—'}</strong>
                  </button>
                ))}
              </div>
              <div className="source-dates">
                <span>Documents资料日期 {date(sources.documents?.dataDate)}</span>
                <span>Comments资料日期 {date(sources.comments?.dataDate)}</span>
                {state.comments.at(-1) && !isFull(state.comments.at(-1)!.source) && (
                  <Badge
                    text={
                      state.comments.at(-1)!.source.scope.statuses === 'open-only'
                        ? '仅Open导出'
                        : '意见非完整范围'
                    }
                    tone="amber"
                  />
                )}
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="搜索图号图名负责人"
                    placeholder="搜索图号、图名或负责人"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="负责人筛选"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="">全部负责人</option>
                  {unique(derived.summaries.map((s) => s.owner)).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <select
                  aria-label="专业筛选"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="">全部专业</option>
                  {unique(derived.summaries.map((s) => s.department)).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <select
                  aria-label="批复码筛选"
                  value={approval}
                  onChange={(e) => setApproval(e.target.value)}
                >
                  <option value="">全部批复码</option>
                  {unique(
                    derived.summaries.map((s) => s.currentDocument?.approvalStatus ?? ''),
                  ).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <select
                  aria-label="当前责任方筛选"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="">全部Open责任方</option>
                  {unique(derived.summaries.flatMap((s) => Object.keys(s.openByRole))).map((v) => (
                    <option value={v} key={v}>
                      {roleLabel(v)}
                    </option>
                  ))}
                </select>
                <select aria-label="排序" value={order} onChange={(e) => setOrder(e.target.value)}>
                  <option value="sequence">台账原顺序</option>
                  <option value="owner">按负责人</option>
                </select>
                {(query || owner || department || approval || role || status) && (
                  <button
                    className="icon"
                    title="清除筛选"
                    aria-label="清除筛选"
                    onClick={() => {
                      setQuery('');
                      setOwner('');
                      setDepartment('');
                      setApproval('');
                      setRole('');
                      setStatus('');
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {!state.catalog ? (
                <div className="empty-state">
                  <FileText size={38} />
                  <h3>暂无图纸资料</h3>
                  <div className="row-actions">
                    <button className="primary" onClick={() => setPage('imports')}>
                      导入文控台账
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="drawings-table">
                      <thead>
                        <tr>
                          <th>序号</th>
                          <th>图号 / 图名</th>
                          <th>负责人</th>
                          <th>最新送审</th>
                          <th>对应结果</th>
                          <th>意见（所导出）</th>
                          <th>Open责任方</th>
                          <th>核对</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(listPage * 50, (listPage + 1) * 50).map((s) => (
                          <tr key={s.drawingNo}>
                            <td className="muted">{s.sequence}</td>
                            <td>
                              <button
                                className="drawing-link"
                                onClick={() => setSelected(s.drawingNo)}
                              >
                                <code>{s.drawingNo}</code>
                                <strong>{s.cn || s.en || '未填写图名'}</strong>
                              </button>
                            </td>
                            <td>{s.owner || '—'}</td>
                            <td>
                              <b>{s.currentDocument?.revision || '—'}</b>
                              <small>{date(s.currentDocument?.sent.iso)}</small>
                              <span className="cell-note">
                                {s.currentDocument
                                  ? stateLabel(s.currentDocument.status)
                                  : s.documentAvailability === 'no-valid-sent'
                                    ? '无有效送审日期'
                                    : s.documentAvailability === 'not-imported'
                                      ? '资料未导入'
                                      : '未找到图纸卡'}
                              </span>
                            </td>
                            <td>
                              <Badge
                                text={s.currentDocument?.approvalStatus || '—'}
                                tone={s.currentDocument?.approvalStatus ? 'blue' : 'neutral'}
                              />
                              <small>{date(s.currentDocument?.received.iso)}</small>
                              {s.currentDocument &&
                                !s.currentDocument.received.iso &&
                                s.latestResponse && (
                                  <span className="cell-note">
                                    历史 {s.latestResponse.revision} /{' '}
                                    {s.latestResponse.approvalStatus}
                                  </span>
                                )}
                            </td>
                            <td>
                              {state.comments.length ? (
                                <>
                                  <span className={s.openCount ? 'open-count' : ''}>
                                    Open {s.openCount}
                                  </span>
                                  <small>
                                    Closed {s.closedCount} / 总数 {s.uniqueParentCount}
                                  </small>
                                </>
                              ) : (
                                '未导入'
                              )}
                            </td>
                            <td>
                              <div className="role-cell">
                                {Object.entries(s.openByRole).map(([r, n]) => (
                                  <span key={r}>
                                    {roleLabel(r)} {n}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              {s.note ? (
                                <button
                                  className="icon warning"
                                  title={s.note}
                                  aria-label={`核对 ${s.drawingNo}`}
                                  onClick={() => setSelected(s.drawingNo)}
                                >
                                  <AlertTriangle size={16} />
                                </button>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <p className="empty">未找到匹配图纸</p>}
                  </div>
                  <Pager
                    total={filtered.length}
                    page={Math.min(listPage, Math.max(0, Math.ceil(filtered.length / 50) - 1))}
                    size={50}
                    setPage={setListPage}
                  />
                </>
              )}
            </>
          )}
          {page === 'statistics' && (
            <StatisticsPanel
              state={state}
              ready={loaded && derivedFor === state && !busy}
              openDrawing={setSelected}
              openImports={() => setPage('imports')}
              reportError={setError}
              saveExclusions={async (ids) => {
                if (!state.catalog) return;
                const next = structuredClone(state);
                next.catalog!.statistics = { excludedDrawingNos: ids };
                await commit(next, 'catalog');
                setNotice('统计范围已保存，业务数据保持完整');
              }}
            />
          )}
          {page === 'changes' && (
            <>
              <div className="section-heading">
                <h1>本次变化</h1>
              </div>
              {(['documentChanges', 'commentChanges'] as const).map((key, i) => {
                const c = derived[key];
                return (
                  <section className="change-section" key={key}>
                    <div className="section-heading">
                      <h2>{i === 0 ? 'Documents' : 'Comments'}</h2>
                      {c && (
                        <Badge
                          text={
                            c.confidence === 'complete'
                              ? '完整范围对比'
                              : c.confidence === 'first-data'
                                ? '首次资料'
                                : '范围不足，变化待核查'
                          }
                          tone={c.confidence === 'complete' ? 'green' : 'amber'}
                        />
                      )}
                    </div>
                    <div className="source-dates">
                      {c ? `${date(c.beforeDate)} → ${date(c.afterDate)}` : '尚未导入'}
                    </div>
                    {c?.changes.length ? (
                      <div className="changes-list">
                        {c.changes.map((change, n) => (
                          <div className="change-row" key={n}>
                            <Badge
                              text={kindLabel(change.kind)}
                              tone={change.kind === 'closed' ? 'green' : 'blue'}
                            />
                            <code>{change.key}</code>
                            <div>
                              {change.links.map((l) => (
                                <button
                                  key={l.drawingNo + l.revision}
                                  className="text-button"
                                  onClick={() => setSelected(l.drawingNo)}
                                >
                                  {l.drawingNo}
                                  <ChevronRight size={14} />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty">{c ? '未识别到新的业务变化' : '暂无资料'}</p>
                    )}
                  </section>
                );
              })}
            </>
          )}
          {page === 'imports' && (
            <>
              <div className="section-heading">
                <h1>资料导入</h1>
                {!state.project && (
                  <button onClick={() => setProjectModal(true)}>
                    <Settings size={17} />
                    设置项目
                  </button>
                )}
              </div>
              <div className="import-bands">
                {(['catalog', 'documents', 'comments'] as const).map((kind) => (
                  <section key={kind}>
                    <div>
                      <h2>{inputNames[kind]}</h2>
                      <p>{sources[kind]?.filename || '尚未导入'}</p>
                      <small>
                        资料日期 {date(sources[kind]?.dataDate)} · 导入时间{' '}
                        {stamp(sources[kind]?.importedAt)}
                      </small>
                    </div>
                    <div className="row-actions">
                      <FileInput
                        label={`上传${inputNames[kind]}`}
                        accept=".xlsx"
                        disabled={Boolean(busy)}
                        onFile={(f) => prepare(f, kind)}
                      />
                      <button
                        className="icon"
                        title={`撤销${inputNames[kind]}导入`}
                        aria-label={`撤销${inputNames[kind]}导入`}
                        disabled={!state.undo[kind] || Boolean(busy)}
                        onClick={async () => {
                          try {
                            await commit(undoImport(state, kind));
                            setNotice(`${inputNames[kind]}最近一次导入已撤销`);
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        <RotateCcw size={17} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              {state.catalog && (
                <p className="notice">
                  当前项目 {state.project?.name} · 关注 {state.catalog.followed.length}{' '}
                  张；台账保留原始文件用于导出。
                </p>
              )}
            </>
          )}
          {page === 'letters' && (
            <Suspense fallback={<p className="empty">正在打开Letter处理…</p>}>
              <Letters state={state} notify={setNotice} />
            </Suspense>
          )}
          {page === 'data' && (
            <>
              <div className="section-heading">
                <h1>数据管理</h1>
              </div>
              <div className="data-facts">
                <div>
                  <small>本地项目</small>
                  <strong>{state.project?.name || '未设置'}</strong>
                </div>
                <div>
                  <small>基础图纸</small>
                  <strong>{state.catalog?.catalog.drawings.length ?? 0}</strong>
                </div>
                <div>
                  <small>Documents快照</small>
                  <strong>{state.documents.length} / 2</strong>
                </div>
                <div>
                  <small>Comments快照</small>
                  <strong>{state.comments.length} / 2</strong>
                </div>
              </div>
              <section className="data-section">
                <h2>备份与恢复</h2>
                <div className="row-actions">
                  <button
                    disabled={!state.project}
                    className="primary"
                    onClick={() =>
                      download(
                        exportBackup(state),
                        `DNV_${state.project?.projectKey}_备份_${localDay()}.json`,
                        'application/json',
                      )
                    }
                  >
                    <Download size={17} />
                    下载备份
                  </button>
                  <FileInput
                    label="恢复备份"
                    accept=".json"
                    onFile={async (f) => {
                      try {
                        if (f.size > 80 * 1024 * 1024) throw new Error('备份超过80 MB');
                        setRestore(validateBackup(await f.text()));
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                </div>
                <p className="notice">
                  备份包含本机业务资料及原台账模板。换设备、清理浏览器数据或更换网址前，请先保存备份。
                </p>
              </section>
              <section className="data-section">
                <h2>导入记录</h2>
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...state.operations].reverse().map((o) => (
                      <tr key={o.id}>
                        <td>{inputNames[o.kind]}</td>
                        <td>{stamp(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </main>
        <footer>本地资料 · 最近资料日期与导入时间分别记录</footer>
      </div>
      {detail && (
        <Detail
          key={detail.drawingNo}
          summary={detail}
          state={state}
          close={() => setSelected(null)}
          saveOverride={updateOverride}
        />
      )}
      {selected && !detail && (
        <Modal title={selected} close={() => setSelected(null)}>
          <p className="notice">此图号不在当前关注范围；相关记录保留在导出资料中。</p>
        </Modal>
      )}
      {prepared && (
        <ImportPreview
          prepared={prepared}
          state={state}
          close={() => setPrepared(null)}
          confirm={async (p, followed) => {
            await commit(applyImport(state, p, followed), p.kind);
            setPrepared(null);
            setNotice(`${inputNames[p.kind]}已保存`);
          }}
        />
      )}
      {projectModal && (
        <Modal title="项目设置" error={error} close={() => setProjectModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const p = {
                name: String(f.get('name')).trim(),
                projectKey: String(f.get('key')).trim(),
                projectId: String(f.get('id')).trim(),
              };
              try {
                if (
                  (state.catalog || state.documents.length || state.comments.length) &&
                  (p.projectKey !== state.project?.projectKey ||
                    p.projectId !== state.project?.projectId)
                )
                  throw new Error('已有项目资料，不能直接更改项目身份');
                await commit({ ...state, project: p });
                setProjectModal(false);
                setNotice('项目设置已保存');
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <label>
              项目名称
              <input required name="name" defaultValue={state.project?.name} />
            </label>
            <label>
              项目标识
              <input
                required
                name="key"
                pattern="[a-z0-9-]+"
                defaultValue={state.project?.projectKey}
              />
            </label>
            <label>
              DNV项目号
              <input
                required
                name="id"
                inputMode="numeric"
                pattern="[0-9]+"
                defaultValue={state.project?.projectId}
              />
            </label>
            <div className="modal-actions">
              <button type="submit" className="primary">
                确认项目
              </button>
            </div>
          </form>
        </Modal>
      )}
      {restore && (
        <Modal title="恢复预览" close={() => setRestore(null)}>
          <p>
            <b>{restore.project?.name}</b> · DNV {restore.project?.projectId}
          </p>
          <p>
            {restore.catalog?.catalog.drawings.length ?? 0} 张基础图纸 · Documents{' '}
            {restore.documents.length} 个快照 · Comments {restore.comments.length} 个快照
          </p>
          <p className="notice">
            确认后替换船检工具的本机资料；其他系统不变。基础资料、快照、原台账及撤销记录已校验。
          </p>
          <div className="modal-actions">
            <button onClick={() => setRestore(null)}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await commit(restore);
                  setRestore(null);
                  setNotice('备份恢复成功');
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              确认恢复
            </button>
          </div>
        </Modal>
      )}
      {exportModal && (
        <Modal title="导出台账预览" close={() => setExportModal(false)} wide>
          <p className="notice">
            保留原工作表、原单元格及旧船检列，在主表右侧追加新统计列。数值对应当前所导出范围；缺失和未确认范围会写入数据说明。
          </p>
          <div className="source-row">
            <strong>{state.template?.filename}</strong>
            <span>{derived.summaries.length} 张关注图纸</span>
          </div>
          <div className="table-scroll">
            <table className="export-table">
              <thead>
                <tr>
                  <th>图号</th>
                  {ledgerFields.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {derived.summaries.slice(0, 10).map((s) => (
                  <tr key={s.drawingNo}>
                    <td>{s.drawingNo}</td>
                    {ledgerValues(s, state).map((v, i) => (
                      <td key={i}>{v ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button onClick={() => setExportModal(false)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                try {
                  download(
                    exportLedger(state, derived.summaries),
                    `${state.template!.filename.replace(/\.xlsx$/i, '')}_DNV更新.xlsx`,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  );
                  setExportModal(false);
                  setNotice('更新版台账已导出');
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Download size={17} />
              确认导出
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
