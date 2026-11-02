import * as XLSX from 'xlsx';
import { MAX_FILE_BYTES } from './contracts';
import type {
  Rows,
  ImportContext,
  DrawingCatalogV1,
  DocumentRecord,
  CommentsData,
  Issue,
  ParseResult,
  SourceMeta,
} from './contracts';
import type { PreparedImport, InputKind } from './model';
import { bytesToBase64 } from './model';
import {
  dateValue,
  drawingNo,
  headerKey,
  dnvRequired,
  messageKind,
  mergeDocuments,
  mergeMessages,
  validateProjectIds,
} from './rules';
import { ledgerFields } from './ledger-fields';

const txt = (v: unknown) => String(v ?? '').trim();
const get = (row: Record<string, unknown>, names: string[]) => {
  const key = Object.keys(row).find((key) =>
    names.some((name) => headerKey(key) === headerKey(name)),
  );
  return key ? row[key] : null;
};
const aliases = {
  no: ['Drawing Number 图号', 'Drawing Number', '图号'],
  name: ['Drawing Name 图名', 'Drawing Name', '图名'],
  owner: ['系统负责人', 'Owner Name', '负责人'],
  department: ['Yard Depart. 专业', 'Yard Depart.', '专业'],
  dnv: ['DNV 船检', 'DNV', '船检'],
};
export const requiredHeaders: Record<InputKind, string[][]> = {
  catalog: [aliases.no, aliases.name, aliases.owner, aliases.dnv],
  documents: [
    ['Document No.'],
    ['Document Title'],
    ['Revision'],
    ['Sent Date'],
    ['Status'],
    ['Approval Status'],
    ['Received Date'],
    ['Open comments'],
  ],
  comments: [
    'Project Id',
    'CommentId',
    'Is Reply',
    'Id Sort Order',
    'Status',
    'Type',
    'Title',
    'Description',
    'Issue Date',
    'Issued By Role',
    'Action Needed By',
    'Last Activity',
    'Closed Date',
    'Document no',
    'Document rev',
  ].map((h) => [h]),
};

export function parseCatalog(rows: Rows, context: ImportContext): ParseResult<DrawingCatalogV1> {
  const issues: Issue[] = [];
  const drawings: DrawingCatalogV1['drawings'] = [];
  const seen = new Map<string, string>();
  for (const row of rows) {
    const no = drawingNo(get(row, aliases.no));
    if (!no) continue;
    const title = txt(get(row, aliases.name));
    const parts = title
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const cnParts = parts.filter((s) => /[\u3400-\u9fff]/.test(s));
    const item: DrawingCatalogV1['drawings'][number] = {
      drawingNo: no,
      type: 'detail',
      cn: cnParts.join(' / '),
      en: parts.filter((s) => !/[\u3400-\u9fff]/.test(s)).join(' '),
      owner: txt(get(row, aliases.owner)),
      department: txt(get(row, aliases.department)),
      dnvRequired: dnvRequired(get(row, aliases.dnv)),
    };
    if (!item.cn && /[\u3400-\u9fff]/.test(title)) item.cn = title;
    const value = JSON.stringify(item);
    if (seen.has(no)) {
      if (seen.get(no) !== value)
        issues.push({
          code: 'catalog-conflict',
          severity: 'blocking',
          key: no,
          rows: [Number(row.__row)],
        });
      continue;
    }
    seen.set(no, value);
    drawings.push(item);
    if (item.dnvRequired === null)
      issues.push({
        code: 'unknown-dnv-mark',
        severity: 'warning',
        key: no,
        rows: [Number(row.__row)],
      });
  }
  if (!drawings.length) issues.push({ code: 'empty-catalog', severity: 'blocking', rows: [] });
  return {
    data: {
      format: 'drawing-catalog',
      schemaVersion: 1,
      projectKey: context.project.projectKey,
      source: {
        filename: context.source.filename,
        importedAt: context.source.importedAt,
        dataDate: context.source.dataDate,
      },
      drawings,
    },
    issues,
    canSave: !issues.some((i) => i.severity === 'blocking'),
  };
}

export function parseDocuments(rows: Rows, context: ImportContext): ParseResult<DocumentRecord[]> {
  const issues: Issue[] = [];
  const records = rows
    .filter((row) => txt(row['Document No.']))
    .map((row) => {
      const open = txt(row['Open comments']);
      const item: DocumentRecord = {
        projectKey: context.project.projectKey,
        drawingNo: drawingNo(row['Document No.']),
        title: txt(row['Document Title']),
        revision: txt(row.Revision),
        status: txt(row.Status),
        approvalStatus: txt(row['Approval Status']),
        sent: dateValue(row['Sent Date']),
        received: dateValue(row['Received Date']),
        openComments: open !== '' && /^\d+$/.test(open) ? Number(open) : null,
        sources: [{ row: Number(row.__row), sourceFingerprint: context.source.fingerprint }],
      };
      if (item.sent.issue || item.received.issue)
        issues.push({
          code: 'invalid-date',
          severity: 'warning',
          key: item.drawingNo,
          rows: [Number(row.__row)],
        });
      return item;
    });
  const merged = mergeDocuments(records);
  if (!records.length)
    return {
      data: [],
      issues: [{ code: 'empty-documents', severity: 'blocking', rows: [] }],
      canSave: false,
    };
  return { ...merged, issues: [...issues, ...merged.issues] };
}

export function parseComments(rows: Rows, context: ImportContext): ParseResult<CommentsData> {
  const issues: Issue[] = validateProjectIds(
    context.project.projectId,
    rows.map((row) => txt(row['Project Id'])),
  );
  const records = rows.map((row) => {
    const order = txt(row['Id Sort Order']);
    const mid = txt(row.CommentId);
    if (!mid)
      issues.push({ code: 'missing-message-id', severity: 'blocking', rows: [Number(row.__row)] });
    if (!/^\d+$/.test(order) || !Number.isSafeInteger(Number(order)))
      issues.push({
        code: 'invalid-order',
        severity: 'warning',
        rows: [Number(row.__row)],
        key: mid,
      });
    const item = {
      projectId: txt(row['Project Id']),
      messageId: mid,
      parentId: null,
      kind: messageKind(row['Is Reply']),
      sortOrder: /^\d+$/.test(order) && Number.isSafeInteger(Number(order)) ? Number(order) : null,
      status: txt(row.Status),
      type: txt(row.Type),
      title: txt(row.Title),
      description: txt(row.Description),
      discipline: txt(row.Discipline),
      issuedByRole: txt(row['Issued By Role']),
      actionNeededBy: txt(row['Action Needed By']),
      issueDate: dateValue(row['Issue Date']),
      lastActivity: dateValue(row['Last Activity']),
      closedDate: dateValue(row['Closed Date']),
      links: txt(row['Document no'])
        ? [{ drawingNo: drawingNo(row['Document no']), revision: txt(row['Document rev']) }]
        : [],
      sources: [{ row: Number(row.__row), sourceFingerprint: context.source.fingerprint }],
      superseded: [],
    };
    if (item.issueDate.issue || item.lastActivity.issue || item.closedDate.issue)
      issues.push({
        code: 'invalid-date',
        severity: 'warning',
        rows: [Number(row.__row)],
        key: mid,
      });
    return item;
  });
  const merged = mergeMessages(records);
  if (!records.length) issues.push({ code: 'empty-comments', severity: 'blocking', rows: [] });
  issues.push(...merged.issues);
  return {
    data: {
      messages: merged.data,
      orphanMessageIds: merged.data.filter((m) => !m.parentId).map((m) => m.messageId),
    },
    issues,
    canSave: !issues.some((i) => i.severity === 'blocking'),
  };
}

export function sourceDateFromFilename(filename: string): string | null {
  const match = /(20\d{2})[-.](\d{1,2})[-.](\d{1,2})/.exec(filename);
  return match
    ? (dateValue(`${match[1]}-${match[2]}-${match[3]}`).iso?.slice(0, 10) ?? null)
    : null;
}

export function prepareWorkbook(
  buffer: ArrayBuffer,
  kind: InputKind,
  context: ImportContext,
): PreparedImport {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('文件超过20 MB限制');
  const book = XLSX.read(buffer, { type: 'array', cellDates: false });
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    if (!sheet['!ref']) continue;
    const size = XLSX.utils.decode_range(sheet['!ref']);
    if (size.e.r > 50000 || size.e.c > 200) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: true,
      range: 0,
    });
    const headerRow = grid
      .slice(0, 20)
      .findIndex((row) =>
        requiredHeaders[kind].every((names) =>
          row.some((v) => names.some((name) => headerKey(v) === headerKey(name))),
        ),
      );
    if (headerRow < 0) continue;
    const headers = grid[headerRow].map(txt);
    const duplicateRequired = requiredHeaders[kind].some(
      (names) => headers.filter((h) => names.some((n) => headerKey(n) === headerKey(h))).length > 1,
    );
    if (duplicateRequired) throw new Error('必要表头重复，无法确定对应列');
    const dateColumns = new Set(
      kind === 'documents'
        ? ['Sent Date', 'Received Date']
        : kind === 'comments'
          ? ['Issue Date', 'Last Activity', 'Closed Date']
          : [],
    );
    const rows: Rows = grid
      .slice(headerRow + 1)
      .map((cells, index) => {
        const row: Record<string, unknown> = { __row: headerRow + index + 2 };
        headers.forEach((h, column) => {
          let value = cells[column] ?? null;
          if (dateColumns.has(h) && typeof value === 'number')
            value = dateValue(value + (date1904 ? 1462 : 0)).iso;
          const canonical =
            kind === 'catalog'
              ? h
              : ([...requiredHeaders[kind].flat(), 'Discipline'].find(
                  (name) => headerKey(name) === headerKey(h),
                ) ?? h);
          row[canonical] = value;
        });
        return row;
      })
      .filter((row) =>
        Object.entries(row).some(
          ([key, value]) => key !== '__row' && value !== null && value !== '',
        ),
      );
    const result =
      kind === 'catalog'
        ? parseCatalog(rows, context)
        : kind === 'documents'
          ? parseDocuments(rows, context)
          : parseComments(rows, context);
    const prepared: PreparedImport = { kind, source: context.source, result, rawRows: rows.length };
    if (kind === 'catalog') {
      const rowMap: Record<string, number> = {};
      for (const row of rows) {
        const no = drawingNo(get(row, aliases.no));
        if (no) rowMap[no] = Number(row.__row);
      }
      const tail = headers.slice(-ledgerFields.length);
      const reusesDerivedColumns =
        tail.length === ledgerFields.length && tail.every((h, i) => h === ledgerFields[i]);
      prepared.template = {
        filename: context.source.filename,
        base64: bytesToBase64(new Uint8Array(buffer)),
        sheetName,
        headerRow: headerRow + 1,
        columnCount: size.e.c + 1 - (reusesDerivedColumns ? ledgerFields.length : 0),
        rows: rowMap,
        reusesDerivedColumns,
      };
    }
    return prepared;
  }
  throw new Error('未找到对应表头，或表格超过50,000行/201列限制。请检查上传类型与文件。');
}
