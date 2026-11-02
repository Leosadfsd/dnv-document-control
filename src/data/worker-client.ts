export function runWorker<T>(
  action: 'prepare' | 'derive',
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/data.worker.ts', import.meta.url), {
      type: 'module',
    });
    const abort = () => {
      worker.terminate();
      reject(new Error('任务已取消'));
    };
    const done = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      done();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    worker.onerror = (event) => {
      done();
      reject(
        new Error(
          `资料处理未能完成。请刷新页面重试；若刚更新过工具，请关闭旧页面并重新打开网页。${event.message ? ` 详细信息：${event.message}` : ''}`,
        ),
      );
    };
    worker.postMessage({ id: crypto.randomUUID(), action, payload });
  });
}
