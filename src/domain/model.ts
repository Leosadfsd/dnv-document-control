import type {
  CatalogState,
  CommentsData,
  DocumentRecord,
  ProjectSettings,
  Snapshot,
  SourceMeta,
  DrawingSummary,
  Comparison,
} from './contracts';

export type InputKind = SourceMeta['kind'];
export interface LedgerTemplate {
  filename: string;
  base64: string;
  sheetName: string;
  headerRow: number;
  columnCount: number;
  rows: Record<string, number>;
  reusesDerivedColumns?: boolean;
}
export interface UndoData {
  catalog?: CatalogState | null;
  template?: LedgerTemplate | null;
  documents?: Snapshot<DocumentRecord[]>[];
  comments?: Snapshot<CommentsData>[];
}
export interface ToolState {
  revision: number;
  project: ProjectSettings | null;
  catalog: CatalogState | null;
  template: LedgerTemplate | null;
  documents: Snapshot<DocumentRecord[]>[];
  comments: Snapshot<CommentsData>[];
  undo: Partial<Record<InputKind, UndoData>>;
  operations: Array<{ id: string; kind: InputKind; createdAt: string }>;
}
export const emptyState = (): ToolState => ({
  revision: 0,
  project: null,
  catalog: null,
  template: null,
  documents: [],
  comments: [],
  undo: {},
  operations: [],
});
export interface Summary extends DrawingSummary {
  cn: string;
  en: string;
  owner: string;
  department: string;
  sequence: number;
  history: DocumentRecord[];
  latestResponse: DocumentRecord | null;
  parents: import('./contracts').CommentMessage[];
  lastYardActivity: string | null;
  lastDnvActivity: string | null;
  staleDocuments: boolean;
  staleComments: boolean;
  note: string;
}
export interface Derived {
  summaries: Summary[];
  documentChanges: Comparison;
  commentChanges: Comparison;
}
export interface PreparedImport {
  kind: InputKind;
  source: SourceMeta;
  result: import('./contracts').ParseResult<
    import('./contracts').DrawingCatalogV1 | DocumentRecord[] | CommentsData
  >;
  template?: LedgerTemplate;
  rawRows: number;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(text);
}
export function base64ToBytes(encoded: string): Uint8Array {
  const text = atob(encoded);
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
