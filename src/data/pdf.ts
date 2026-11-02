import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseLetterItems } from '../domain/letter';
import type { PdfTextItem } from '../domain/letter';
import { MAX_FILE_BYTES } from '../domain/contracts';

GlobalWorkerOptions.workerSrc = workerUrl;
export async function readLetter(bytes: Uint8Array, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('任务已取消');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('PDF超过20 MB限制');
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const abort = () => {
    void loading.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 100) throw new Error('Letter超过100页，请拆成较小文件');
    const items: PdfTextItem[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      if (signal?.aborted) throw new Error('任务已取消');
      const page = await pdf.getPage(number),
        content = await page.getTextContent();
      for (const item of content.items)
        if ('str' in item)
          items.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            page: number,
          });
      page.cleanup();
    }
    return parseLetterItems(items);
  } finally {
    signal?.removeEventListener('abort', abort);
    await loading.destroy();
  }
}
