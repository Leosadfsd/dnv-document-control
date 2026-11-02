import { useState, useRef, useEffect } from 'react';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import type { ToolState } from '../domain/model';
import type { LetterResult } from '../domain/letter';
import { letterFilename, safeFilename } from '../domain/letter';
import { download } from '../data/ledger-export';
import { FileInput } from './components';

export function LetterPanel({
  state,
  notify,
}: {
  state: ToolState;
  notify: (text: string) => void;
}) {
  const [result, setResult] = useState<LetterResult | null>(null),
    [bytes, setBytes] = useState<Uint8Array | null>(null),
    [fileName, setFileName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = result?.candidates.filter((c) => c.selected) ?? [];
  const names = selected.map((c, i) => letterFilename(result!.letterNo, c, i));
  const tooLarge = (bytes?.byteLength ?? 0) * selected.length > 100 * 1024 * 1024;
  const valid =
    Boolean(result?.letterNo) &&
    selected.length > 0 &&
    selected.every((c) => c.drawingNo && c.cn && c.owner) &&
    new Set(names).size === names.length &&
    new Set(selected.map((c) => c.drawingNo)).size === selected.length &&
    !tooLarge;
  function updateCandidate(index: number, key: 'drawingNo' | 'cn' | 'owner', value: string) {
    if (!result) return;
    const candidates = result.candidates.map((row, n) => {
      if (n !== index) return row;
      if (key !== 'drawingNo') return { ...row, [key]: value };
      const no = value.trim().toUpperCase(),
        d = state.catalog?.catalog.drawings.find((d) => d.drawingNo === no),
        o = state.catalog?.overrides[no];
      return { ...row, drawingNo: no, cn: o?.cn ?? d?.cn ?? '', owner: o?.owner ?? d?.owner ?? '' };
    });
    setResult({ ...result, candidates });
  }
  async function load(file: File) {
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('PDF超过20 MB限制');
      const data = new Uint8Array(await file.arrayBuffer());
      const { readLetter } = await import('../data/pdf');
      const parsed = await readLetter(data, controller.current.signal);
      const drawings = state.catalog?.catalog.drawings ?? [];
      parsed.candidates = parsed.candidates.map((c) => {
        const d = drawings.find((d) => d.drawingNo === c.drawingNo),
          override = state.catalog?.overrides[c.drawingNo];
        return { ...c, cn: override?.cn ?? d?.cn ?? '', owner: override?.owner ?? d?.owner ?? '' };
      });
      setBytes(data);
      setResult(parsed);
      setFileName(file.name);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="section-heading">
        <h2>Approval Letter</h2>
        <FileInput label="上传Letter" accept=".pdf" onFile={load} disabled={busy} />
      </div>
      {busy && (
        <div className="flash busy">
          <span>正在读取PDF批复表…</span>
          <button onClick={() => controller.current?.abort()}>取消</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!result ? (
        <div className="empty-state">
          <Copy size={34} />
          <h3>暂无Letter</h3>
        </div>
      ) : (
        <>
          <div className="source-row">
            <strong>{fileName}</strong>
            <label className="compact">
              Letter编号
              <input
                value={result.letterNo}
                onChange={(e) => setResult({ ...result, letterNo: e.target.value })}
              />
            </label>
          </div>
          {result.issues.map((issue) => (
            <p className="notice" key={issue}>
              {issue}
            </p>
          ))}
          <div className="table-scroll">
            <table className="letter-table">
              <thead>
                <tr>
                  <th>选取</th>
                  <th>图号</th>
                  <th>中文图名</th>
                  <th>负责人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label={`选取 ${c.drawingNo}`}
                        type="checkbox"
                        checked={c.selected}
                        onChange={(e) =>
                          setResult({
                            ...result,
                            candidates: result.candidates.map((row, n) =>
                              n === i ? { ...row, selected: e.target.checked } : row,
                            ),
                          })
                        }
                      />
                    </td>
                    {(['drawingNo', 'cn', 'owner'] as const).map((key) => (
                      <td key={key}>
                        <input
                          aria-label={`${key} ${i + 1}`}
                          value={c[key]}
                          placeholder={
                            key === 'drawingNo'
                              ? '图号'
                              : key === 'cn'
                                ? '待补充图名'
                                : '待补充负责人'
                          }
                          onChange={(e) => updateCandidate(i, key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="icon"
                        title="移除"
                        aria-label={`移除 ${i + 1}`}
                        onClick={() =>
                          setResult({
                            ...result,
                            candidates: result.candidates.filter((_, n) => n !== i),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <button
              onClick={() =>
                setResult({
                  ...result,
                  candidates: [
                    ...result.candidates,
                    { drawingNo: '', cn: '', owner: '', englishTitle: '', selected: true },
                  ],
                })
              }
            >
              <Plus size={17} />
              增加图号
            </button>
            <span>{selected.length} 份输出 · 保留整封Letter</span>
          </div>
          <div className="filename-list">
            {names.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
          {!valid && (
            <p className="notice">请补齐编号、图号、中文图名和负责人，并核对输出文件名。</p>
          )}
          {tooLarge && (
            <p className="notice">输出PDF总量超过100 MB，请减少本次选取数量并分批下载。</p>
          )}
          <div className="row-actions">
            <button
              disabled={!valid}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(names.join('\n'));
                  notify('命名清单已复制');
                } catch {
                  download(names.join('\n'), 'Letter命名清单.txt', 'text/plain;charset=utf-8');
                }
              }}
            >
              <Copy size={17} />
              复制命名清单
            </button>
            <button
              className="primary"
              disabled={!valid || !bytes}
              onClick={() => {
                const files: Record<string, Uint8Array> = {};
                selected.forEach((c, i) => (files[letterFilename(result.letterNo, c, i)] = bytes!));
                files['命名清单.txt'] = strToU8(names.join('\n'));
                download(
                  zipSync(files, { level: 0 }),
                  `Approval_Letter_NB_${safeFilename(result.letterNo)}.zip`,
                );
                notify(`已打包 ${selected.length} 份Letter`);
              }}
            >
              <Download size={17} />
              下载PDF包
            </button>
          </div>
        </>
      )}
    </section>
  );
}
