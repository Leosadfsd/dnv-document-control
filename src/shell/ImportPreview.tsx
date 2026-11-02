import { useState } from 'react';
import type { PreparedImport, ToolState } from '../domain/model';
import type { DrawingCatalogV1, CommentsData } from '../domain/contracts';
import { Modal, Badge } from './components';

export function ImportPreview({
  prepared: p,
  state,
  close,
  confirm,
}: {
  prepared: PreparedImport;
  state: ToolState;
  close: () => void;
  confirm: (prepared: PreparedImport, followed?: string[]) => Promise<void>;
}) {
  const [source, setSource] = useState(p.source),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const catalog = p.kind === 'catalog' ? (p.result.data as DrawingCatalogV1) : null;
  const initial = new Set([
    ...(state.catalog?.followed ?? []),
    ...(catalog?.drawings.filter((d) => d.dnvRequired === true).map((d) => d.drawingNo) ?? []),
  ]);
  const [followed, setFollowed] = useState(initial);
  const currentMap = new Map(state.catalog?.catalog.drawings.map((d) => [d.drawingNo, d]) ?? []);
  const reviewed = catalog
    ? catalog.drawings.filter(
        (d) =>
          !currentMap.has(d.drawingNo) ||
          d.dnvRequired !== currentMap.get(d.drawingNo)?.dnvRequired ||
          d.dnvRequired === null,
      )
    : [];
  const missing = catalog
    ? (state.catalog?.catalog.drawings.filter(
        (d) => !catalog.drawings.some((n) => n.drawingNo === d.drawingNo),
      ) ?? [])
    : [];
  const count = Array.isArray(p.result.data)
    ? p.result.data.length
    : catalog
      ? catalog.drawings.length
      : (p.result.data as CommentsData).messages.length;
  const scopeComplete =
    source.scope.confirmedByUser &&
    source.scope.project === 'all' &&
    source.scope.revisions === 'all' &&
    (p.kind !== 'comments' || source.scope.statuses === 'all');
  return (
    <Modal title={`导入预览 · ${p.kind === 'catalog' ? '文控台账' : p.kind}`} close={close} wide>
      <div className="import-summary">
        <strong>{p.source.filename}</strong>
        <span>
          原始 {p.rawRows} 行 · 整理后 {count} 条
        </span>
        <Badge
          text={p.result.canSave ? '可导入' : '存在阻断问题'}
          tone={p.result.canSave ? 'green' : 'red'}
        />
      </div>
      <div className="form-grid">
        <label>
          资料日期
          <input
            type="date"
            value={source.dataDate ?? ''}
            onChange={(e) => setSource({ ...source, dataDate: e.target.value || null })}
          />
        </label>
        <label>
          当前项目
          <input readOnly value={`${state.project?.name} · DNV ${state.project?.projectId}`} />
        </label>
      </div>
      {p.kind !== 'catalog' && (
        <div className="scope-row">
          <label className="check">
            <input
              type="checkbox"
              checked={scopeComplete}
              onChange={(e) =>
                setSource({
                  ...source,
                  scope: {
                    project: e.target.checked ? 'all' : 'unconfirmed',
                    revisions: e.target.checked ? 'all' : 'unconfirmed',
                    statuses: e.target.checked ? 'all' : 'unconfirmed',
                    confirmedByUser: e.target.checked,
                  },
                })
              }
            />
            {p.kind === 'comments'
              ? '确认覆盖本项目全部状态及全部版本'
              : '确认覆盖本项目全部图纸及全部版本'}
          </label>
          <select
            aria-label="导出意见范围"
            value={source.scope.statuses}
            onChange={(e) =>
              setSource({
                ...source,
                scope: {
                  ...source.scope,
                  statuses: e.target.value as typeof source.scope.statuses,
                  confirmedByUser: e.target.value !== 'unconfirmed',
                },
              })
            }
          >
            <option value="unconfirmed">范围未确认</option>
            <option value="all">全部状态</option>
            <option value="open-only">仅Open</option>
            <option value="partial">部分资料</option>
          </select>
        </div>
      )}
      {!scopeComplete && p.kind !== 'catalog' && (
        <p className="notice">范围未确认完整：保留所导出内容，不据此判断整体闭环或记录消失。</p>
      )}
      {catalog && (
        <>
          <p className="notice">
            确认关注范围：新增图纸按DNV标记勾选；取消标记或本次缺失的旧关注项保留勾选，取消后仍保留历史。
          </p>
          <div className="review-list">
            {[...reviewed, ...missing].map((d) => (
              <label className="review-row" key={d.drawingNo}>
                <input
                  type="checkbox"
                  checked={followed.has(d.drawingNo)}
                  onChange={(e) => {
                    const next = new Set(followed);
                    e.target.checked ? next.add(d.drawingNo) : next.delete(d.drawingNo);
                    setFollowed(next);
                  }}
                />
                <code>{d.drawingNo}</code>
                <span>{d.cn || d.en}</span>
                <Badge
                  text={
                    missing.includes(d)
                      ? '本次缺失'
                      : !currentMap.has(d.drawingNo)
                        ? '新增'
                        : d.dnvRequired === null
                          ? '标记待确认'
                          : '标记变化'
                  }
                />
              </label>
            ))}
          </div>
          <p>{followed.size} 张关注图纸</p>
        </>
      )}
      {state.documents.at(-1)?.source.dataDate &&
        p.kind === 'documents' &&
        source.dataDate &&
        source.dataDate < state.documents.at(-1)!.source.dataDate! && (
          <p className="notice">本次资料日期早于已保存资料，请核对导入顺序。</p>
        )}
      {p.result.issues.length > 0 && (
        <div className="issues">
          <h3>核对项 {p.result.issues.length}</h3>
          {p.result.issues.slice(0, 50).map((i, n) => (
            <p key={n}>
              {i.severity === 'blocking' ? '阻断' : '关注'} · {i.code} · {i.key ?? ''} · 行{' '}
              {i.rows.slice(0, 10).join(', ')}
            </p>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button onClick={close} disabled={saving}>
          取消
        </button>
        <button
          className="primary"
          disabled={!p.result.canSave || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const next = { ...p, source };
              if (catalog)
                next.result = {
                  ...p.result,
                  data: {
                    ...catalog,
                    source: {
                      filename: source.filename,
                      importedAt: source.importedAt,
                      dataDate: source.dataDate,
                    },
                  },
                };
              await confirm(next, catalog ? [...followed] : undefined);
            } catch (e) {
              setError(String(e));
              setSaving(false);
            }
          }}
        >
          {saving ? '保存中…' : '确认导入'}
        </button>
      </div>
    </Modal>
  );
}
