import { setTimeout as delay } from 'node:timers/promises';
import type { BuildLease } from '@davidniessen/doctopus-domain';
import type { PreparedSource, WorkerConfig } from './config.js';
import type { BuildExecutor } from './executor.js';
import {
  sameApproval,
  SourceApprovalChanged,
  BuildExecutionDeadline,
} from './executor.js';
import { ControlPlaneError } from './protocol.js';
import type { WorkerControlPlane } from './protocol.js';
export type WorkerEvent =
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'lease_lost'
  | 'stopped'
  | 'settlement_unconfirmed'
  | 'control_unavailable'
  | 'storage_unavailable';
interface WorkerOptions {
  config: WorkerConfig;
  control: WorkerControlPlane;
  execute: BuildExecutor;
  signal: AbortSignal;
  report?: (event: WorkerEvent, jobId?: string) => void;
  canStart?: (source: PreparedSource, reservedMiB: number) => Promise<boolean>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
const pause = (milliseconds: number, signal: AbortSignal) =>
  delay(milliseconds, undefined, { signal });
async function perform(
  lease: BuildLease,
  source: PreparedSource,
  options: WorkerOptions,
) {
  const { control, signal, execute } = options;
  const wait = options.wait ?? pause;
  const report = (event: WorkerEvent) => options.report?.(event, lease.job.id);
  const controller = new AbortController();
  const heartbeatStop = new AbortController();
  const stop = () => {
    controller.abort();
    heartbeatStop.abort();
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  let owned = true,
    settling = false;
  let heartbeat: Promise<void> | undefined;
  try {
    controller.signal.throwIfAborted();
    if (!(await control.heartbeat(lease, controller.signal))) {
      owned = false;
      report('lease_lost');
      return;
    }
    heartbeat = (async () => {
      try {
        while (!heartbeatStop.signal.aborted) {
          await wait(10000, heartbeatStop.signal);
          if (!(await control.heartbeat(lease, heartbeatStop.signal)))
            throw new Error('Lease lost');
        }
      } catch {
        if (!heartbeatStop.signal.aborted) {
          owned = false;
          // Source execution must stop immediately on uncertain ownership.
          // A completion already in flight can safely retry its settled token.
          if (!settling) controller.abort();
          report('lease_lost');
        }
      }
    })();
    if (!sameApproval(lease, source))
      throw new SourceApprovalChanged('Local source approval changed');
    const result = await execute(
      { job: lease.job, source: lease.source },
      source,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    settling = true;
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      try {
        await control.complete(lease, result, signal);
        report('succeeded');
        return;
      } catch (error) {
        failure = error;
        if (
          error instanceof ControlPlaneError &&
          error.status < 500 &&
          error.status !== 429
        )
          break;
        if (attempt < 2) await wait(250 * 2 ** attempt, signal);
      }
    }
    throw failure;
  } catch (error) {
    if (signal.aborted) {
      report('stopped');
      return;
    }
    if (!owned || controller.signal.aborted) return;
    if (
      settling &&
      !(error instanceof ControlPlaneError && error.status === 400)
    ) {
      report('settlement_unconfirmed');
      return;
    }
    try {
      await control.fail(
        lease,
        error instanceof SourceApprovalChanged
          ? 'source_changed'
          : error instanceof BuildExecutionDeadline
            ? 'deadline_exceeded'
            : 'build_failed',
        signal,
      );
      report('failed');
    } catch {
      report('settlement_unconfirmed');
    }
  } finally {
    stop();
    signal.removeEventListener('abort', stop);
    await heartbeat;
  }
}
/** Independent host concurrency/resource admission; no source execution on the request server. */
export async function runWorker(options: WorkerOptions): Promise<void> {
  const { config, control, signal } = options;
  const report = (event: WorkerEvent, jobId?: string) => {
    try {
      options.report?.(event, jobId);
    } catch {
      /* An unavailable event sink must not strand a lease. */
    }
  };
  const tasks = new Map<
    string,
    { source: PreparedSource; task: Promise<void> }
  >();
  const stopping = new AbortController();
  const activeOptions = {
    ...options,
    report,
    signal: AbortSignal.any([signal, stopping.signal]),
  };
  let idlePollMs = config.pollMs;
  try {
    while (!signal.aborted) {
      let memory = 0,
        cpus = 0,
        diskMiB = 0;
      for (const { source } of tasks.values()) {
        memory += source.policy.limits.memoryMiB;
        cpus += source.policy.limits.cpus;
        diskMiB +=
          source.policy.limits.sourceMiB + 2 * source.policy.limits.outputMiB;
      }
      const eligible: PreparedSource[] = [];
      let storageUnavailable = false;
      if (tasks.size < config.maxConcurrency) {
        for (const source of config.sources) {
          if (
            tasks.has(source.id) ||
            memory + source.policy.limits.memoryMiB > config.maxMemoryMiB ||
            cpus + source.policy.limits.cpus > config.maxCpus
          )
            continue;
          try {
            if (
              options.canStart &&
              !(await options.canStart(source, diskMiB))
            ) {
              storageUnavailable = true;
              continue;
            }
            eligible.push(source);
          } catch {
            storageUnavailable = true;
          }
        }
      }
      if (storageUnavailable) report('storage_unavailable');
      if (eligible.length) {
        try {
          const lease = await control.claim(
            config.workerId,
            eligible.map((source) => source.id),
            signal,
          );
          signal.throwIfAborted();
          if (lease) {
            const source = eligible.find(
              (source) => source.id === lease.source.id,
            );
            if (!source)
              throw new Error('Claimed source is not locally eligible');
            idlePollMs = config.pollMs;
            report('claimed', lease.job.id);
            const task = perform(lease, source, activeOptions).finally(() => {
              tasks.delete(source.id);
            });
            tasks.set(source.id, { source, task });
            continue;
          }
        } catch (error) {
          if (signal.aborted) break;
          if (
            error instanceof ControlPlaneError &&
            [401, 403].includes(error.status)
          )
            throw error;
          report('control_unavailable');
        }
      }
      try {
        const interval = tasks.size ? config.pollMs : idlePollMs;
        await (options.wait ?? pause)(interval, signal);
        idlePollMs = tasks.size
          ? config.pollMs
          : Math.min(30000, idlePollMs * 2);
      } catch {
        if (!signal.aborted) throw new Error('Worker polling failed');
      }
    }
  } finally {
    stopping.abort();
    await Promise.allSettled(Array.from(tasks.values(), ({ task }) => task));
  }
}
