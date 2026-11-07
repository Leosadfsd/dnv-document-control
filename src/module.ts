// Host-neutral entry point for future integration with the owner drawing tool.
// UI, IndexedDB and the application shell are intentionally not imported here.
export { buildOpenCommentCases, partyLabels, messageText } from './domain/open-cases';
export type {
  OpenCasesInput,
  OpenCommentCase,
  CaseDrawing,
  ActionParty,
} from './domain/open-cases';
export {
  exportOpenCases,
  exportDrawingReplies,
  exportDrawingReplyPackage,
  exportDrawingGroups,
} from './data/opinion-export';
export type { OpinionExportContext, DrawingExportOverride } from './data/opinion-export';
export { parseCatalog, parseDocuments, parseComments } from './domain/parse';
export type {
  CatalogState,
  Snapshot,
  CommentsData,
  CommentMessage,
  DocumentRecord,
} from './domain/contracts';
