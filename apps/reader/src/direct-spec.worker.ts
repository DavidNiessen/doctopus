import { parseBrowserSpec } from '@davidniessen/doctopus-spec/browser';
self.onmessage = (event: MessageEvent<{ source: string; url: string }>) => {
  try {
    self.postMessage({
      api: parseBrowserSpec(event.data.source, event.data.url),
    });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message.slice(0, 512)
          : 'Invalid OpenAPI document.',
    });
  }
};
