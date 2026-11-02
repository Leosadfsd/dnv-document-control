import { prepareWorkbook } from '../domain/parse';
import { buildDrawingSummaries, compareDocuments, compareComments } from '../domain/derive';
import type { ToolState } from '../domain/model';

self.onmessage = (event) => {
  const { id, action, payload } = event.data;
  try {
    const result =
      action === 'prepare'
        ? prepareWorkbook(payload.buffer, payload.kind, payload.context)
        : (() => {
            const state = payload as ToolState;
            return {
              summaries: state.catalog
                ? buildDrawingSummaries(
                    state.catalog,
                    state.documents.at(-1) ?? null,
                    state.comments.at(-1) ?? null,
                  )
                : [],
              documentChanges: state.documents.length
                ? compareDocuments(state.documents.at(-2) ?? null, state.documents.at(-1)!)
                : null,
              commentChanges: state.comments.length
                ? compareComments(state.comments.at(-2) ?? null, state.comments.at(-1)!)
                : null,
            };
          })();
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '解析失败' });
  }
};
