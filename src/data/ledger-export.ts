import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { ToolState, Summary } from '../domain/model';
import { base64ToBytes } from '../domain/model';
import { ledgerFields, ledgerValues, dateFieldIndices } from '../domain/ledger-fields';

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

export function exportLedger(state: ToolState, summaries: Summary[]): Uint8Array {
  const template = state.template;
  if (!template) throw new Error('请先导入原文控台账');
  const files = unzipSync(base64ToBytes(template.base64));
  if (!files['xl/workbook.xml'] || !files['xl/_rels/workbook.xml.rels'])
    throw new Error('台账必须是标准.xlsx文件');
  if (Object.keys(files).some((k) => k.startsWith('_xmlsignatures/')))
    throw new Error('原台账包含数字签名，不能直接修改后保留签名');
  const book = parseXml(files['xl/workbook.xml']);
  const sheet = [...book.getElementsByTagName('sheet')].find(
    (s) => attr(s, 'name') === template.sheetName,
  );
  const id = attr(sheet ?? null, 'r:id');
  const rels = parseXml(files['xl/_rels/workbook.xml.rels']);
  const rel = [...rels.getElementsByTagName('Relationship')].find((r) => attr(r, 'Id') === id);
  const target = attr(rel ?? null, 'Target');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  if (!files[path]) throw new Error('原台账主表关联未找到');
  const xml = parseXml(files[path]);
  const data = xml.getElementsByTagName('sheetData')[0];
  if (!data) throw new Error('原台账缺少单元格数据');
  const rows = new Map([...data.getElementsByTagName('row')].map((r) => [Number(attr(r, 'r')), r]));
  const header = rows.get(template.headerRow);
  if (!header) throw new Error('原台账表头行未找到');
  const existingHeader = [...header.getElementsByTagName('c')];
  const headerStyle =
    existingHeader[template.columnCount - 1]?.getAttribute('s') ??
    existingHeader.at(-1)?.getAttribute('s') ??
    null;
  if (template.reusesDerivedColumns) {
    for (const row of rows.values())
      for (const cell of [...row.getElementsByTagName('c')]) {
        const col = attr(cell, 'r').replace(/\d/g, '');
        let index = 0;
        for (const letter of col) index = index * 26 + letter.charCodeAt(0) - 64;
        if (index > template.columnCount) row.removeChild(cell);
      }
  }
  const styles = parseXml(files['xl/styles.xml']);
  const xfs = styles.getElementsByTagName('cellXfs')[0];
  let numFmts = styles.getElementsByTagName('numFmts')[0];
  if (!numFmts) {
    numFmts = styles.createElementNS(NS, 'numFmts');
    styles.documentElement.insertBefore(numFmts, styles.documentElement.firstChild);
  }
  const fmt = Math.max(163, ...[...numFmts.children].map((f) => Number(attr(f, 'numFmtId')))) + 1;
  for (const [offset, format] of [
    [0, 'yyyy-mm-dd'],
    [1, 'yyyy-mm-dd hh:mm'],
  ] as const) {
    const numFmt = styles.createElementNS(NS, 'numFmt');
    numFmt.setAttribute('numFmtId', String(fmt + offset));
    numFmt.setAttribute('formatCode', format);
    numFmts.appendChild(numFmt);
  }
  numFmts.setAttribute('count', String(numFmts.children.length));
  const dateStyles = new Map<string, number>();
  const dateStyle = (original: string | null, time: boolean) => {
    const key = `${original ?? '0'}:${time}`;
    if (dateStyles.has(key)) return dateStyles.get(key)!;
    const xf =
      (xfs.children[Number(original) || 0]?.cloneNode(true) as Element) ??
      styles.createElementNS(NS, 'xf');
    xf.setAttribute('numFmtId', String(fmt + (time ? 1 : 0)));
    xf.setAttribute('applyNumberFormat', '1');
    const index = xfs.children.length;
    xfs.appendChild(xf);
    dateStyles.set(key, index);
    return index;
  };
  const serialize = (doc: XMLDocument) => strToU8(new XMLSerializer().serializeToString(doc));
  const addCell = (
    row: Element,
    column: number,
    value: string | number | null,
    style: string | null,
    date: boolean,
    time = false,
  ) => {
    if (value === null || value === '') return;
    const cell = xml.createElementNS(NS, 'c');
    cell.setAttribute('r', `${columnName(column)}${attr(row, 'r')}`);
    if (style !== null) cell.setAttribute('s', style);
    if (typeof value === 'number' || date) {
      const numeric = date
        ? Date.parse(String(value)) / 86400000 +
          25569 -
          (['1', 'true'].includes(
            book.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904') ?? '',
          )
            ? 1462
            : 0)
        : value;
      if (!Number.isFinite(numeric)) return;
      if (date) cell.setAttribute('s', String(dateStyle(style, time)));
      const v = xml.createElementNS(NS, 'v');
      v.textContent = String(numeric);
      cell.appendChild(v);
    } else {
      cell.setAttribute('t', 'inlineStr');
      const is = xml.createElementNS(NS, 'is'),
        t = xml.createElementNS(NS, 't');
      t.textContent = String(value);
      t.setAttribute('xml:space', 'preserve');
      is.appendChild(t);
      cell.appendChild(is);
    }
    row.appendChild(cell);
  };
  ledgerFields.forEach((field, i) =>
    addCell(header, template.columnCount + i, field, headerStyle, false),
  );
  const map = new Map(summaries.map((s) => [s.drawingNo, s]));
  for (const [no, rowNumber] of Object.entries(template.rows)) {
    const summary = map.get(no),
      row = rows.get(rowNumber);
    if (!summary || !row) continue;
    const rowStyle = [...row.getElementsByTagName('c')].at(-1)?.getAttribute('s') ?? headerStyle;
    ledgerValues(summary, state).forEach((v, i) =>
      addCell(
        row,
        template.columnCount + i,
        v,
        rowStyle,
        dateFieldIndices.has(i),
        i === 16 || i === 17,
      ),
    );
    row.removeAttribute('spans');
  }
  header.removeAttribute('spans');
  const dimension = xml.getElementsByTagName('dimension')[0];
  const lastRow = Math.max(...rows.keys());
  if (dimension)
    dimension.setAttribute(
      'ref',
      `A1:${columnName(template.columnCount + ledgerFields.length - 1)}${lastRow}`,
    );
  let cols = xml.getElementsByTagName('cols')[0];
  if (!cols) {
    cols = xml.createElementNS(NS, 'cols');
    data.parentNode!.insertBefore(cols, data);
  }
  if (template.reusesDerivedColumns)
    for (const col of [...cols.children])
      if (Number(attr(col, 'min')) > template.columnCount) cols.removeChild(col);
  ledgerFields.forEach((_, i) => {
    const col = xml.createElementNS(NS, 'col');
    col.setAttribute('min', String(template.columnCount + i + 1));
    col.setAttribute('max', String(template.columnCount + i + 1));
    col.setAttribute(
      'width',
      i === ledgerFields.length - 1 ? '55' : dateFieldIndices.has(i) ? '23' : '19',
    );
    col.setAttribute('customWidth', '1');
    cols.appendChild(col);
  });
  xfs.setAttribute('count', String(xfs.children.length));
  files[path] = serialize(xml);
  files['xl/styles.xml'] = serialize(styles);
  return zipSync(files, { level: 6 });
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
