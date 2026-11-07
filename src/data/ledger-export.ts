import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { ToolState } from '../domain/model';
import { base64ToBytes } from '../domain/model';
import { buildDrawingSummaries } from '../domain/derive';
import { ledgerWriteback, type WritebackField } from '../domain/ledger-writeback';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const attr = (element: Element | null, name: string) => element?.getAttribute(name) ?? '';
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function parseXml(bytes: Uint8Array): XMLDocument {
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('原台账XML无效，无法保留格式导出');
  return document;
}

export function exportLedgerWithChanges(state: ToolState): {
  bytes: Uint8Array;
  changes: string;
  changedCells: number;
} {
  const template = state.template;
  if (!template || !state.catalog) throw new Error('请先导入已经更新船东数据的原文控台账');
  if (!state.documents.length && !state.comments.length) throw new Error('请先导入DNV导出表');
  const files = unzipSync(base64ToBytes(template.base64));
  if (Object.keys(files).some((k) => k.startsWith('_xmlsignatures/')))
    throw new Error('原台账包含数字签名，不能修改后保留签名');
  const book = parseXml(files['xl/workbook.xml']);
  const sheet = [...book.getElementsByTagName('sheet')].find(
    (s) => attr(s, 'name') === template.sheetName,
  );
  const rels = parseXml(files['xl/_rels/workbook.xml.rels']);
  const rel = [...rels.getElementsByTagName('Relationship')].find(
    (r) => attr(r, 'Id') === attr(sheet ?? null, 'r:id'),
  );
  const target = attr(rel ?? null, 'Target');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  if (!files[path]) throw new Error('原台账主表关联未找到');
  const xml = parseXml(files[path]);
  const rows = new Map([...xml.getElementsByTagName('row')].map((r) => [Number(attr(r, 'r')), r]));
  const shared = files['xl/sharedStrings.xml']
    ? [...parseXml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(
        (n) => n.textContent ?? '',
      )
    : [];
  const read = (c: Element | undefined) =>
    !c
      ? ''
      : attr(c, 't') === 's'
        ? (shared[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? '')
        : attr(c, 't') === 'inlineStr'
          ? (c.getElementsByTagName('is')[0]?.textContent ?? '')
          : (c.getElementsByTagName('v')[0]?.textContent ?? '');
  const indexOf = (c: Element) =>
    [...attr(c, 'r').replace(/\d/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const header = rows.get(template.headerRow);
  if (!header) throw new Error('原台账表头未找到');
  const headers = [...header.getElementsByTagName('c')].map((c) => ({
    index: indexOf(c),
    text: read(c).replace(/\s/g, ''),
  }));
  const start = headers.find((h) => /船检/.test(h.text) && /版本|Version/i.test(h.text))?.index;
  if (start === undefined) throw new Error('未识别到原表船检版本栏，停止写回，避免误改船东栏');
  const scope = headers.filter((h) => h.index >= start && h.index < template.columnCount);
  const find = (pattern: RegExp) => scope.find((h) => pattern.test(h.text))?.index;
  const columns: Partial<Record<WritebackField, number>> = {
    船检送审日期: headers.find(
      (h) => /ActualSubmissionDate|实际送审日期/i.test(h.text) && /船检/.test(h.text),
    )?.index,
    船检版本: start,
    意见状态: find(/Comm.*Status|意见状态/i),
    意见总数: find(/TotalComm|意见总数/i),
    未闭环意见: find(/OpenComm|未闭环意见/i),
    DNV退审首次: find(/DNV.*退审.*首次/i),
    DNV退审第二次: find(/DNV.*退审.*第二/i),
    批复代码: find(/^Remark$|批复代码/i),
  };
  for (const field of ['船检版本', '意见状态', '意见总数', '未闭环意见', '批复代码'] as const)
    if (columns[field] === undefined) throw new Error(`未识别到原船检栏：${field}，停止写回`);
  if (
    new Set(Object.values(columns).filter((x) => x !== undefined)).size !==
    Object.values(columns).filter((x) => x !== undefined).length
  )
    throw new Error('船检栏映射重复，停止写回');
  const summaries = buildDrawingSummaries(
    { ...state.catalog, followed: state.catalog.catalog.drawings.map((d) => d.drawingNo) },
    state.documents.at(-1) ?? null,
    state.comments.at(-1) ?? null,
  );
  const lines = [
    `DNV船检台账更新记录\n原台账：${template.filename}\n工作表：${template.sheetName}`,
    `Documents：${state.documents.at(-1)?.source.filename ?? '未导入'}（资料日期：${state.documents.at(-1)?.source.dataDate ?? '未提供'}）`,
    `Comments：${state.comments.at(-1)?.source.filename ?? '未导入'}（资料日期：${state.comments.at(-1)?.source.dataDate ?? '未提供'}）`,
    '仅更新原船检字段；保留船东栏、其他工作表、原格式和公式。另存新文件，不覆盖原件。',
    '意见只统计父意见，回复流水不计数；GSI答复时间保留原值，不用Last Activity推算正式答复日期。',
    'DNV首次/第二次退审日期取Documents中可见的前两个不同Received日期；后续日期记录在本TXT。',
    '来源范围未确认完整或存在其他状态时，零Open不自动写成已闭环。未匹配图纸保留原值。',
    ...Object.entries(columns).map(
      ([field, index]) =>
        `${field} → ${index === undefined ? '未识别，保留原值' : columnName(index)}`,
    ),
    '',
    '逐项变动：',
  ];
  let changedCells = 0;
  for (const s of summaries) {
    const row = rows.get(template.rows[s.drawingNo]);
    if (!row) continue;
    const update = ledgerWriteback(s, state);
    for (const [field, value] of Object.entries(update.values)) {
      const column = columns[field as WritebackField];
      if (column === undefined) continue;
      const ref = `${columnName(column)}${attr(row, 'r')}`;
      const cells = [...row.getElementsByTagName('c')];
      const old = cells.find((c) => attr(c, 'r') === ref);
      if (String(value) === read(old)) continue;
      if (old?.getElementsByTagName('f').length) {
        lines.push(`${s.drawingNo} ${ref} ${field}：原单元格含公式，保留公式待人工核对`);
        continue;
      }
      const cell = old ?? xml.createElementNS(NS, 'c');
      if (!old) {
        cell.setAttribute('r', ref);
        const neighbor = cells.find((c) => indexOf(c) > column);
        row.insertBefore(cell, neighbor ?? null);
      }
      const before = read(old);
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      if (typeof value === 'number') {
        cell.removeAttribute('t');
        const v = xml.createElementNS(NS, 'v');
        v.textContent = String(value);
        cell.appendChild(v);
      } else {
        cell.setAttribute('t', 'inlineStr');
        const is = xml.createElementNS(NS, 'is'),
          t = xml.createElementNS(NS, 't');
        t.textContent = value;
        t.setAttribute('xml:space', 'preserve');
        is.appendChild(t);
        cell.appendChild(is);
      }
      lines.push(
        `${s.drawingNo} ${ref} ${field}：${before || '（空）'} → ${String(value) || '（空）'}`,
      );
      changedCells++;
    }
    if (update.notes.length) lines.push(`${s.drawingNo} 提示：${update.notes.join('；')}`);
  }
  lines.push(`\n共核对${summaries.length}张台账图纸，修改${changedCells}个船检单元格。`);
  files[path] = strToU8(new XMLSerializer().serializeToString(xml));
  return { bytes: zipSync(files, { level: 6 }), changes: lines.join('\r\n'), changedCells };
}

export function exportLedger(state: ToolState): Uint8Array {
  return exportLedgerWithChanges(state).bytes;
}

export function download(
  bytes: Uint8Array | string,
  filename: string,
  type = 'application/octet-stream',
) {
  const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
