import { strToU8, zipSync } from 'fflate';
import type { OpenCommentCase, CaseDrawing } from '../domain/open-cases';
import { messageText, partyLabels } from '../domain/open-cases';

export interface OpinionExportContext {
  projectName: string;
  projectId: string;
  sourceFilename: string;
  sourceDate: string | null;
  sourceComplete: boolean;
  exportedAt: string;
}
export interface DrawingExportOverride {
  cn: string;
  owner: string;
}
interface Cell {
  text: string;
  style?: number;
}
interface Row {
  cells: Cell[];
  height?: number;
}
interface Sheet {
  name: string;
  widths: number[];
  rows: Row[];
  merges: string[];
  headerRow: number;
  filter?: boolean;
}
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const textCell = (text: unknown, style = 0): Cell => ({ text: String(text ?? ''), style });

// Pre-wrap by display width; split across rows instead of exceeding Excel's 409pt row limit.
export function wrapExportText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const original of text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
    let line = '',
      count = 0;
    for (const ch of original) {
      const weight = ch === '\t' ? 4 : /[^\u0000-\u00ff]/.test(ch) ? 2 : 1;
      if (count + weight > Math.max(6, width - 3) && line) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 3) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1);
          count = [...line].reduce(
            (n, c) => n + (c === '\t' ? 4 : /[^\u0000-\u00ff]/.test(c) ? 2 : 1),
            0,
          );
        } else {
          lines.push(line);
          line = '';
          count = 0;
        }
      }
      line += ch;
      count += weight;
    }
    lines.push(line);
  }
  return lines;
}
function addBody(sheet: Sheet, texts: string[], styles: number[] = [], minimumHeight = 26) {
  const lines = texts.map((text, i) => wrapExportText(text, sheet.widths[i]));
  const chunkLines = 16;
  const chunks = Math.max(1, ...lines.map((l) => Math.ceil(l.length / chunkLines)));
  for (let index = 0; index < chunks; index++) {
    const parts = lines.map((l) => l.slice(index * chunkLines, (index + 1) * chunkLines));
    if (index > 0) parts[0] = wrapExportText(texts[0] + '\n（续）', sheet.widths[0]);
    sheet.rows.push({
      cells: parts.map((part, i) => textCell(part.join('\n'), styles[i] ?? 0)),
      height: Math.max(minimumHeight, Math.max(...parts.map((p) => p.length)) * 16 + 12),
    });
  }
}
function addMerged(sheet: Sheet, text: string, style: number, height: number) {
  const row = sheet.rows.length + 1;
  sheet.rows.push({
    cells: [textCell(text, style)],
    height: Math.max(
      height,
      Math.min(
        332,
        wrapExportText(
          text,
          sheet.widths.reduce((a, b) => a + b, 0),
        ).length *
          16 +
          12,
      ),
    ),
  });
  sheet.merges.push(`A${row}:${col(sheet.widths.length - 1)}${row}`);
}
function top(sheet: Sheet, title: string, context: OpinionExportContext, detail: string) {
  addMerged(sheet, title, 2, 32);
  addMerged(
    sheet,
    `项目：${context.projectName}  |  DNV：${context.projectId}  |  导出：${context.exportedAt}`,
    3,
    25,
  );
  addMerged(
    sheet,
    `来源：${context.sourceFilename}  |  资料日期：${context.sourceDate || '未提供'}  |  ${context.sourceComplete ? '已确认完整范围' : '所导出范围，完整性未确认'}`,
    3,
    36,
  );
  addMerged(sheet, detail, 4, 32);
  addMerged(
    sheet,
    '回方取系统当前责任方；活动时间不等于正式回复日期。长正文续行保留，未匹配项需核对。',
    3,
    25,
  );
}

const styleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FF24332C"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="17"/><name val="Microsoft YaHei"/><color rgb="FF163F36"/></font><font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF59675E"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF205448"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF5EF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F5F3"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCDD8D1"/></left><right style="thin"><color rgb="FFCDD8D1"/></right><top style="thin"><color rgb="FFCDD8D1"/></top><bottom style="thin"><color rgb="FFCDD8D1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function makeWorkbook(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, text: string) => {
    files[name] = strToU8(text);
  };
  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  put(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  put(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xml(s.name)}'!$1:$${s.headerRow}</definedName><definedName name="_xlnm.Print_Area" localSheetId="${i}">'${xml(s.name)}'!$A$1:$${col(s.widths.length - 1)}$${s.rows.length}</definedName>`).join('')}</definedNames></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  put('xl/styles.xml', styleXml);
  sheets.forEach((sheet, i) => {
    const columns = sheet.widths
      .map((width, j) => `<col min="${j + 1}" max="${j + 1}" width="${width}" customWidth="1"/>`)
      .join('');
    const rows = sheet.rows
      .map(
        (row, j) =>
          `<row r="${j + 1}" ht="${row.height ?? 28}" customHeight="1">${row.cells.map((c, k) => `<c r="${col(k)}${j + 1}" s="${c.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(c.text)}</t></is></c>`).join('')}</row>`,
      )
      .join('');
    put(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${col(sheet.widths.length - 1)}${sheet.rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="${sheet.headerRow}" topLeftCell="C${sheet.headerRow + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="28"/><cols>${columns}</cols><sheetData>${rows}</sheetData>${sheet.filter ? `<autoFilter ref="A${sheet.headerRow}:${col(sheet.widths.length - 1)}${sheet.rows.length}"/>` : ''}<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.15" footer="0.2"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;C第 &amp;P 页 / 共 &amp;N 页</oddFooter></headerFooter></worksheet>`,
    );
  });
  return zipSync(files);
}

export function exportOpenCases(
  cases: OpenCommentCase[],
  context: OpinionExportContext,
): Uint8Array {
  const sheet: Sheet = {
    name: '未闭环清单',
    widths: [15, 27, 16, 43, 43, 43, 18, 23],
    rows: [],
    merges: [],
    headerRow: 6,
    filter: true,
  };
  top(
    sheet,
    'DNV 未闭环意见处理清单',
    context,
    `本次导出 ${cases.length} 条主意见；续行属于同一意见，不计作新增意见。`,
  );
  sheet.rows.push({
    cells: [
      '序号 / 意见ID',
      '图号 / 图名',
      '负责人',
      '主意见',
      '我方最近一轮',
      '船检最近一轮',
      '当前处理方',
      '数据提示 / 最近活动',
    ].map((t) => textCell(t, 1)),
    height: 32,
  });
  const ownerKey = (c: OpenCommentCase) =>
    [...new Set(c.drawings.map((d) => d.owner).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .join('、');
  const ordered = [...cases].sort((a, b) => {
    const x = ownerKey(a),
      y = ownerKey(b);
    return (
      (x === y ? 0 : !x ? 1 : !y ? -1 : x.localeCompare(y, 'zh-CN')) ||
      Math.min(...a.drawings.map((d) => d.sequence), Number.MAX_SAFE_INTEGER) -
        Math.min(...b.drawings.map((d) => d.sequence), Number.MAX_SAFE_INTEGER) ||
      a.parent.messageId.localeCompare(b.parent.messageId, undefined, { numeric: true })
    );
  });
  ordered.forEach((c, index) => {
    addBody(
      sheet,
      [
        `${index + 1}\n${c.parent.messageId}`,
        c.drawings.map((d) => `${d.drawingNo}\n${d.cn || d.en || '图名待补'}`).join('\n\n') ||
          '未关联图纸',
        [...new Set(c.drawings.map((d) => d.owner || '负责人待补'))].join('\n'),
        messageText(c.parent),
        c.latestYardRound.map(messageText).join('\n\n') || '暂无船厂回复',
        c.latestDnvRound.map(messageText).join('\n\n') || '暂无船检后续回复',
        `${partyLabels[c.party]}\n${c.systemRole || '未提供系统责任方'}\n${c.reason}`,
        `${c.warnings.join('\n')}\n最近活动：${c.latestActivity?.slice(0, 16).replace('T', ' ') || '未提供'}`,
      ],
      [6, 0, 0, 0, 5, 0, c.party === 'confirm' ? 4 : 0, 3],
    );
  });
  return makeWorkbook([sheet]);
}

export function exportDrawingReplies(
  cases: OpenCommentCase[],
  drawing: CaseDrawing,
  context: OpinionExportContext,
): Uint8Array {
  const sheet: Sheet = {
    name: 'COMMENTS RECORD',
    widths: [9, 65, 13, 65, 13, 18, 20],
    rows: [],
    merges: [],
    headerRow: 6,
  };
  top(
    sheet,
    'COMMENTS RECORD OF DRAWINGS',
    context,
    `${drawing.drawingNo} · ${drawing.cn || drawing.en || '图名待补'} · 负责人：${drawing.owner || '待补'} · ${cases.length} 条未闭环主意见`,
  );
  sheet.rows.push({
    cells: [
      'No. / 轮次',
      'DNV Comment / 船检意见',
      'Author',
      'Shipyard Reply / 船厂回复',
      'Author',
      '状态 / 当前回方',
      '附件 / 数据提示',
    ].map((t) => textCell(t, 1)),
    height: 36,
  });
  cases.forEach((c, index) => {
    addMerged(
      sheet,
      `${index + 1}. ${c.parent.messageId} · ${c.parent.title} · ${c.parent.type} · ${partyLabels[c.party]}（${c.systemRole || '未指定'}）`,
      4,
      40,
    );
    for (const [i, m] of c.thread.entries()) {
      const yard = ['Yard Design', 'Yard Site'].includes(m.issuedByRole);
      const author =
        (
          {
            'Approval Expert': 'DNV审图',
            'NB Surveyor': '验船师',
            'Yard Design': '船厂设计',
            'Yard Site': '船厂现场',
          } as Record<string, string>
        )[m.issuedByRole] || m.issuedByRole;
      addBody(
        sheet,
        [
          `${index + 1}.${i + 1}`,
          yard ? '' : messageText(m),
          yard ? '' : author,
          yard ? messageText(m) : '',
          yard ? author : '',
          `${c.parent.status}\n${partyLabels[c.party]}`,
          i === 0 ? c.warnings.join('\n') : '',
        ],
        [6, 0, 0, 5, 5, 0, 3],
      );
    }
    addBody(
      sheet,
      ['待填', '', '', '', '', `Open\n${partyLabels[c.party]}`, '下一轮船厂回复位置'],
      [5, 0, 0, 5, 5, 0, 3],
      80,
    );
  });
  return makeWorkbook([sheet]);
}
export function exportDrawingGroups(
  cases: OpenCommentCase[],
  overrides: Record<string, DrawingExportOverride> = {},
) {
  const groups = new Map<string, { drawing: CaseDrawing; cases: OpenCommentCase[] }>();
  for (const c of cases)
    for (const drawing of c.drawings) {
      if (!groups.has(drawing.drawingNo))
        groups.set(drawing.drawingNo, {
          drawing: { ...drawing, ...overrides[drawing.drawingNo] },
          cases: [],
        });
      groups.get(drawing.drawingNo)!.cases.push(c);
    }
  return [...groups.values()].sort(
    (a, b) =>
      a.drawing.sequence - b.drawing.sequence ||
      a.drawing.drawingNo.localeCompare(b.drawing.drawingNo),
  );
}
export function safeFilename(value: string): string {
  return (
    [
      ...value
        .normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/, ''),
    ]
      .slice(0, 75)
      .join('') || '待补'
  );
}
export function exportDrawingReplyPackage(
  cases: OpenCommentCase[],
  context: OpinionExportContext,
  overrides: Record<string, DrawingExportOverride> = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const group of exportDrawingGroups(cases, overrides)) {
    const d = group.drawing;
    const base = [d.drawingNo, d.cn || d.en || '图名待补', d.owner || '负责人待补', 'DNV']
      .map(safeFilename)
      .join('-');
    let name = base + '.xlsx',
      index = 1;
    while (used.has(name.toLowerCase())) name = base + `_${++index}.xlsx`;
    used.add(name.toLowerCase());
    files[name] = exportDrawingReplies(group.cases, d, context);
  }
  const unlinked = cases.filter((c) => !c.drawings.length);
  if (unlinked.length) files['待匹配图纸的意见.xlsx'] = exportOpenCases(unlinked, context);
  files['导出说明.txt'] = strToU8(
    `本次选中 ${cases.length} 条未闭环主意见，按实际图纸关联生成回复表。跨图纸的同一意见会在对应各图出现，意见ID保持一致。\n主意见及全部已导入往来保留，待填行不自动生成技术回复。\n来源：${context.sourceFilename}\n资料日期：${context.sourceDate || '未提供'}\n范围：${context.sourceComplete ? '已确认完整' : '未确认完整，历史可能不全'}\n导出：${context.exportedAt}\n无图纸关联的意见：${unlinked.length} 条，另放待匹配清单。\n长正文按续行保留；打印为A3横向、重复表头，纸张可在Excel/WPS中调整。`,
  );
  return zipSync(files);
}
