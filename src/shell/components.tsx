import { useEffect, useRef, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, Upload } from 'lucide-react';

export const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');
export const stamp = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 16).replace('T', ' ') : '—';
export const localStamp = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    : '—';
export const localDay = () => localStamp(new Date().toISOString()).slice(0, 10);
export const roleLabel = (role: string) =>
  ({
    'Yard Design': '船厂设计',
    'Yard Site': '船厂现场',
    'Approval Expert': 'DNV审图',
    'NB Surveyor': '验船师',
    None: '无当前责任方',
  })[role] ?? role;
export const stateLabel = (status: string) =>
  ({
    Received: '已取得处理结果',
    Sent: '已送审待处理',
    Open: '未关闭',
    Closed: '已关闭',
    NA: 'NA',
  })[status] ?? status;
export const kindLabel = (kind: string) =>
  ({
    version: '送审记录变化',
    status: '图纸状态变化',
    approval: '批复变化',
    'new-parent': '新父意见',
    'new-yard-reply': '新船厂回复',
    'new-dnv-reply': '新DNV回复',
    'new-other-reply': '其他新回复',
    closed: '意见关闭',
    reopened: '意见重新打开',
    responsibility: '责任方变化',
    'not-found': '本次未找到',
    'first-data': '首次资料',
    unmatched: '未匹配往来',
    'message-update': '正文更新',
    association: '关联变化',
  })[kind] ?? kind;
export function Modal({
  title,
  children,
  close,
  wide = false,
  error,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" title="关闭" aria-label="关闭" onClick={close}>
          <X size={19} />
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {children}
    </dialog>
  );
}
export function Pager({
  total,
  page,
  size,
  setPage,
}: {
  total: number;
  page: number;
  size: number;
  setPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pager">
      <span>
        {total} 条 · {page + 1} / {pages}
      </span>
      <button
        className="icon"
        disabled={page === 0}
        title="上一页"
        aria-label="上一页"
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      <button
        className="icon"
        disabled={page + 1 >= pages}
        title="下一页"
        aria-label="下一页"
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
export function FileInput({
  label,
  accept,
  onFile,
  disabled = false,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        aria-label={label}
        className="file-input"
        type="file"
        accept={accept}
        onChange={(event) => {
          const f = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (f) onFile(f);
        }}
        disabled={disabled}
      />
      <button disabled={disabled} onClick={() => ref.current?.click()}>
        <Upload size={17} />
        {label}
      </button>
    </>
  );
}
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{text}</span>;
}
