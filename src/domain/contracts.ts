export const CONTRACT_VERSION = 1 as const;
export const DATABASE_NAME = 'dnv-drawing-tool';
export const DATABASE_VERSION = 1;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface ProjectSettings {
  projectKey: string;
  name: string;
  projectId: string;
}

export interface DrawingCatalogV1 {
  format: 'drawing-catalog';
  schemaVersion: 1;
  projectKey: string;
  source: { filename: string; importedAt: string; dataDate: string | null };
  drawings: Array<{
    drawingNo: string;
    type: 'detail';
    cn: string;
    en: string;
    owner: string;
    department: string;
    dnvRequired: boolean | null;
  }>;
}

export interface DateValue {
  raw: string;
  iso: string | null;
  issue: 'invalid-date' | null;
}

export interface SourceMeta {
  kind: 'catalog' | 'documents' | 'comments';
  filename: string;
  fingerprint: string;
  importedAt: string;
  dataDate: string | null;
  scope: {
    project: 'all' | 'partial' | 'unconfirmed';
    revisions: 'all' | 'partial' | 'unconfirmed';
    statuses: 'all' | 'open-only' | 'partial' | 'unconfirmed';
    confirmedByUser: boolean;
  };
}

export interface SourceRef {
  row: number;
  sourceFingerprint: string;
}
export interface Issue {
  code: string;
  severity: 'warning' | 'blocking';
  rows: number[];
  key?: string;
}
export interface ParseResult<T> {
  data: T;
  issues: Issue[];
  canSave: boolean;
}
export interface DocumentRecord {
  projectKey: string;
  drawingNo: string;
  title: string;
  revision: string;
  status: string;
  approvalStatus: string;
  sent: DateValue;
  received: DateValue;
  openComments: number | null;
  sources: SourceRef[];
}
export interface DocumentLink {
  drawingNo: string;
  revision: string;
}
export interface CommentMessage {
  projectId: string;
  messageId: string;
  parentId: string | null;
  kind: 'parent' | 'reply' | 'unknown';
  sortOrder: number | null;
  status: string;
  type: string;
  title: string;
  description: string;
  discipline: string;
  issuedByRole: string;
  actionNeededBy: string;
  issueDate: DateValue;
  lastActivity: DateValue;
  closedDate: DateValue;
  links: DocumentLink[];
  sources: SourceRef[];
  superseded: Array<Omit<CommentMessage, 'superseded'>>;
}
export interface CommentsData {
  messages: CommentMessage[];
  orphanMessageIds: string[];
}
export interface Snapshot<T> {
  snapshotId: string;
  projectKey: string;
  source: SourceMeta;
  data: T;
  issues: Issue[];
  missingFromLatest: string[];
  lastImportUnchanged?: boolean;
  missingLinks?: Array<{ messageId: string; drawingNo: string; revision: string }>;
}
export interface CatalogState {
  catalog: DrawingCatalogV1;
  followed: string[];
  overrides: Record<string, { cn?: string; en?: string; owner?: string }>;
  statistics?: { excludedDrawingNos: string[] };
}
export interface DrawingSummary {
  drawingNo: string;
  currentDocument: DocumentRecord | null;
  documentAvailability: 'not-imported' | 'not-found' | 'no-valid-sent' | 'available';
  firstSent: DateValue | null;
  firstReceived: DateValue | null;
  uniqueParentCount: number;
  openCount: number;
  closedCount: number;
  otherCount: number;
  openByRole: Record<string, number>;
  candidateYardDesignCount: number;
  sourceDates: { documents: string | null; comments: string | null };
}
export interface Change {
  kind:
    | 'first-data'
    | 'version'
    | 'status'
    | 'approval'
    | 'new-parent'
    | 'new-yard-reply'
    | 'new-dnv-reply'
    | 'new-other-reply'
    | 'closed'
    | 'reopened'
    | 'responsibility'
    | 'not-found'
    | 'unmatched'
    | 'message-update'
    | 'association';
  key: string;
  links: DocumentLink[];
}
export interface Comparison {
  confidence: 'first-data' | 'complete' | 'range-insufficient';
  beforeDate: string | null;
  afterDate: string | null;
  changes: Change[];
}
export interface ImportContext {
  project: ProjectSettings;
  source: SourceMeta;
}
export type Rows = Array<Record<string, unknown>>;

// M0 freezes signatures; workbook parsing, diffs and persistence are implemented in M1.
export interface DnvCoreV1 {
  parseCatalog(rows: Rows, context: ImportContext): ParseResult<DrawingCatalogV1>;
  parseDocuments(rows: Rows, context: ImportContext): ParseResult<DocumentRecord[]>;
  parseComments(rows: Rows, context: ImportContext): ParseResult<CommentsData>;
  buildDrawingSummaries(
    catalog: CatalogState,
    documents: Snapshot<DocumentRecord[]> | null,
    comments: Snapshot<CommentsData> | null,
  ): DrawingSummary[];
  compareDocuments(
    before: Snapshot<DocumentRecord[]> | null,
    after: Snapshot<DocumentRecord[]>,
  ): Comparison;
  compareComments(before: Snapshot<CommentsData> | null, after: Snapshot<CommentsData>): Comparison;
}

export interface DnvBackupV1 {
  format: 'dnv-tool-backup';
  schemaVersion: 1;
  project: ProjectSettings;
  catalog: CatalogState | null;
  documents: Snapshot<DocumentRecord[]>[];
  comments: Snapshot<CommentsData>[];
  operations: Array<{ id: string; kind: SourceMeta['kind']; createdAt: string }>;
  undo: Partial<Record<SourceMeta['kind'], unknown>>;
}
export interface SaveReceipt {
  operationId: string;
  snapshotId: string;
  unchanged: boolean;
}
export interface DnvRepository {
  loadCatalog(projectKey: string): Promise<CatalogState | null>;
  saveCatalog(projectKey: string, result: ParseResult<CatalogState>): Promise<SaveReceipt>;
  loadDocuments(projectKey: string): Promise<Snapshot<DocumentRecord[]>[]>;
  saveDocuments(
    projectKey: string,
    result: ParseResult<Snapshot<DocumentRecord[]>>,
  ): Promise<SaveReceipt>;
  loadComments(projectKey: string): Promise<Snapshot<CommentsData>[]>;
  saveComments(
    projectKey: string,
    result: ParseResult<Snapshot<CommentsData>>,
  ): Promise<SaveReceipt>;
  loadThread(
    projectKey: string,
    parentId: string,
    page: number,
    pageSize: 20,
  ): Promise<{ messages: CommentMessage[]; total: number }>;
  exportBackup(projectKey: string): Promise<DnvBackupV1>;
  restoreBackup(backup: DnvBackupV1): Promise<SaveReceipt>;
  undo(projectKey: string, kind: SourceMeta['kind']): Promise<void>;
}
export interface DnvModuleProps {
  projectKey: string;
  catalog: CatalogState;
  repository: DnvRepository;
}
