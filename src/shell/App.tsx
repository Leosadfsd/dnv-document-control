import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  FileText,
  History,
  Database,
  Settings,
  Download,
  Upload,
  FolderInput,
  Files,
  RotateCcw,
  ShieldCheck,
  X,
  ChevronRight,
  AlertTriangle,
  Menu,
  BarChart3,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import type { SourceMeta, Comparison, ProjectSettings } from '../domain/contracts';
import type { ToolState, Summary, PreparedImport, InputKind } from '../domain/model';
import { emptyState } from '../domain/model';
import { applyImport, undoImport, buildDrawingSummaries } from '../domain/derive';
import { loadState, saveState, exportBackup, validateBackup } from '../data/storage';
import { runWorker } from '../data/worker-client';
import { sourceDateFromFilename } from '../domain/parse';
import { exportLedger, download } from '../data/ledger-export';
import { ledgerFields, ledgerValues } from '../domain/ledger-fields';
import { Detail } from './Detail';
import { ImportPreview } from './ImportPreview';
import { StatisticsPanel } from './StatisticsPanel';
import { OpenCommentsPanel } from './OpenCommentsPanel';
import { DrawingsPanel } from './DrawingsPanel';
import {
  Modal,
  FileInput,
  Badge,
  date,
  localStamp as stamp,
  localDay,
  kindLabel,
} from './components';
const Letters = lazy(() => import('./LetterPanel').then((m) => ({ default: m.LetterPanel })));
type Page =
  | 'opinions'
  | 'tools'
  | 'statistics'
  | 'drawings'
  | 'changes'
  | 'imports'
  | 'letters'
  | 'data';
interface DerivedData {
  summaries: Summary[];
  documentChanges: Comparison | null;
  commentChanges: Comparison | null;
}
const nav = [
  { id: 'opinions', label: '未闭环意见', icon: MessageSquare },
  { id: 'drawings', label: '图纸查询', icon: FileText },
  { id: 'tools', label: '辅助工具', icon: Wrench },
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
    [page, setPage] = useState<Page>('opinions');
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
              aria-current={
                page === item.id ||
                (item.id === 'tools' && !['opinions', 'drawings'].includes(page))
                  ? 'page'
                  : undefined
              }
              onClick={() => {
                setPage(item.id);
                setMenu(false);
              }}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === 'drawings' && (
                <span>{state.catalog?.catalog.drawings.length ?? '—'}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          本机数据 <small>0.4.0</small>
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
          {!['opinions', 'drawings', 'tools'].includes(page) && (
            <button className="back-to-tools" onClick={() => setPage('tools')}>
              返回辅助工具
            </button>
          )}
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
            <DrawingsPanel
              state={state}
              openDrawing={setSelected}
              openImports={() => setPage('imports')}
            />
          )}
          {page === 'opinions' && (
            <OpenCommentsPanel
              state={state}
              openImports={() => setPage('imports')}
              reportError={setError}
            />
          )}
          {page === 'tools' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>辅助工具</h1>
                  <span className="muted">资料更新、文件处理与数据维护</span>
                </div>
              </div>
              <div className="tool-grid">
                {[
                  {
                    id: 'imports',
                    label: '资料导入',
                    icon: FolderInput,
                    description: '更新Comments、台账及Documents，核对来源范围',
                  },
                  {
                    id: 'letters',
                    label: 'Letter处理',
                    icon: Files,
                    description: '按图号复制整封批复信并命名',
                  },
                  {
                    id: 'statistics',
                    label: '船检统计',
                    icon: BarChart3,
                    description: '查看送审、返回及闭环的辅助统计',
                  },
                  {
                    id: 'changes',
                    label: '本次变化',
                    icon: History,
                    description: '核对新意见、回复及状态变化',
                  },
                  {
                    id: 'data',
                    label: '备份与数据管理',
                    icon: Database,
                    description: '备份恢复、来源记录和撤销',
                  },
                ].map((t) => (
                  <button key={t.id} onClick={() => setPage(t.id as Page)}>
                    <t.icon size={24} />
                    <strong>{t.label}</strong>
                    <span>{t.description}</span>
                  </button>
                ))}
              </div>
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
                aria-label="项目标识"
                pattern="[a-z0-9-]+"
                defaultValue={state.project?.projectKey}
              />
              <small>本机识别用，例如 kiwi-fhl；使用小写字母、数字或短横线。</small>
            </label>
            <label>
              DNV项目号
              <input
                required
                name="id"
                aria-label="DNV项目号"
                inputMode="numeric"
                pattern="[0-9]+"
                defaultValue={state.project?.projectId}
              />
              <small>填写系统导出表中的 Project Id，例如 D123456 文件对应 123456。</small>
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
