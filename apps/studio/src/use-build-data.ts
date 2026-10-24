import { useEffect, useState } from 'react';
import type {
  BuildPage,
  ProjectBuildCapabilities,
} from '@davidniessen/doctopus-domain';
import {
  readCapabilities,
  readJob,
  readPage,
  readSource,
} from './build-data.js';
import type { JobRow, SourceRow } from './build-data.js';
import { StudioApiError } from './api.js';
import type { StudioApi } from './api.js';

export function useBuildData(
  projectId: string,
  api: StudioApi,
  sourceAfter: string | undefined,
  jobAfter: string | undefined,
  includeRevoked: boolean,
) {
  const key = JSON.stringify([
    projectId,
    sourceAfter,
    jobAfter,
    includeRevoked,
  ]);
  const [result, setResult] = useState<{
    key: string;
    capabilities: ProjectBuildCapabilities;
    sources: BuildPage<SourceRow>;
    jobs: BuildPage<JobRow>;
  }>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false,
      current: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      activeJobs = false;
    const base = '/api/projects/' + encodeURIComponent(projectId);
    async function load() {
      if (disposed || document.hidden) return;
      clearTimeout(timer);
      current?.abort();
      const controller = new AbortController();
      current = controller;
      setLoading(true);
      setError('');
      try {
        const sourceQuery = new URLSearchParams({
          activeOnly: String(!includeRevoked),
        });
        if (sourceAfter) sourceQuery.set('after', sourceAfter);
        const jobQuery = jobAfter
          ? '?after=' + encodeURIComponent(jobAfter)
          : '';
        const [access, sourceData, jobData] = await Promise.all([
          api<unknown>(
            base + '/build-capabilities',
            'GET',
            undefined,
            controller.signal,
          ),
          api<unknown>(
            base + '/build-sources?' + sourceQuery,
            'GET',
            undefined,
            controller.signal,
          ),
          api<unknown>(
            base + '/builds' + jobQuery,
            'GET',
            undefined,
            controller.signal,
          ),
        ]);
        const capabilities = readCapabilities(access, projectId),
          sources = readPage(sourceData, (value) =>
            readSource(value, projectId),
          ),
          jobs = readPage(jobData, (value) => readJob(value, projectId));
        if (disposed || controller.signal.aborted) return;
        activeJobs = jobs.items.some(
          (job) => job.state === 'queued' || job.state === 'running',
        );
        setResult({ key, capabilities, sources, jobs });
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          if (
            error instanceof StudioApiError &&
            [401, 403, 404].includes(error.status)
          )
            setResult(undefined);
          setError(
            error instanceof Error
              ? error.message
              : 'Build history is unavailable.',
          );
        }
      } finally {
        if (!disposed && current === controller) {
          setLoading(false);
          controller.abort();
          if (!document.hidden)
            timer = setTimeout(() => void load(), activeJobs ? 10000 : 30000);
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
      clearTimeout(timer);
      current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [api, projectId, sourceAfter, jobAfter, includeRevoked, revision, key]);
  const ready = result?.key === key;
  return {
    capabilities: result?.capabilities,
    sources: ready ? result.sources : { items: [], nextCursor: null },
    jobs: ready ? result.jobs : { items: [], nextCursor: null },
    loading: loading || (!ready && !error),
    error,
    refresh: () => setRevision((value) => value + 1),
  };
}
