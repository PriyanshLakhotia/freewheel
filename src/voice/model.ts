import type { Model as VoskModel } from 'vosk-browser';
/** vosk-browser's convenience loader does not reject worker errors; bound both paths here. */
export async function loadOfflineModel(): Promise<VoskModel> {
  const { Model } = await import('vosk-browser');
  return new Promise((resolve, reject) => {
    const model = new Model(new URL('/api/model', location.href).href, 0);
    const fail = (message: string) => {
      clearTimeout(timer);
      model.terminate();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Offline speech took too long to load. Reload Freewheel and try again.'),
      45000,
    );
    // The pinned library does not forward worker startup errors through its public events.
    const worker = (model as unknown as { worker: Worker }).worker;
    worker.addEventListener(
      'error',
      (event) => fail(`Offline speech worker: ${event.message || 'could not start'}`),
      { once: true },
    );
    model.on('load', (message) => {
      if (message.event !== 'load') return;
      if (message.result) {
        clearTimeout(timer);
        resolve(model);
      } else fail('The offline speech model could not load.');
    });
    model.on('error', (message) => {
      if (message.event === 'error')
        fail(`Offline speech: ${message.error || 'model could not load'}`);
    });
  });
}
