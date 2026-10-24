import { useEffect, useState } from 'react';
import type { ProjectCapabilities } from '@davidniessen/doctopus-domain';
import { StudioApiError } from './api.js';
import type { StudioApi } from './api.js';
import { readProjectCapabilities } from './project-capabilities.js';

export function useProjectCapabilities(projectId: string, api: StudioApi) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    projectId: string;
    api: StudioApi;
    capabilities?: ProjectCapabilities;
    error?: string;
    denied?: boolean;
  }>();
  useEffect(() => {
    if (!projectId) return;
    let disposed = false,
      current: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (disposed || document.hidden) return;
      clearTimeout(timer);
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const value = await api<unknown>(
          `/api/projects/${encodeURIComponent(projectId)}/capabilities`,
          'GET',
          undefined,
          controller.signal,
        );
        const capabilities = readProjectCapabilities(value, projectId);
        if (!disposed && !controller.signal.aborted)
          setResult({ projectId, api, capabilities });
      } catch (error) {
        if (!disposed && !controller.signal.aborted)
          setResult({
            projectId,
            api,
            error:
              error instanceof Error
                ? error.message
                : 'Project permissions are unavailable.',
            denied:
              error instanceof StudioApiError &&
              [403, 404].includes(error.status),
          });
      } finally {
        if (!disposed && current === controller) {
          controller.abort();
          if (!document.hidden) timer = setTimeout(() => void load(), 30000);
        }
      }
    }
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        current?.abort();
      } else void load();
    };
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => {
      disposed = true;
      current?.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [api, projectId, revision]);
  const ready = result?.api === api && result.projectId === projectId;
  return {
    capabilities: ready ? result.capabilities : undefined,
    error: ready ? result.error : undefined,
    denied: ready ? result.denied : false,
    loading: !!projectId && !ready,
    refresh: () => {
      setResult(undefined);
      setRevision((value) => value + 1);
    },
  };
}
