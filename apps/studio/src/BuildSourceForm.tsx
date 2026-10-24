import {
  defaultIsolatedBuildLimits,
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import type {
  BuildPolicy,
  SourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
const limits = [
  ['timeoutMs', 'Build deadline (ms)', 1000, 900000],
  ['memoryMiB', 'Memory (MiB)', 512, 4096],
  ['cpus', 'CPU count', 1, 4],
  ['pids', 'Process count', 32, 512],
  ['sourceMiB', 'Source limit (MiB)', 1, 1024],
  ['outputMiB', 'Output limit (MiB)', 32, 1024],
] as const;
export interface SourceApprovalInput {
  label: string;
  revision?: string;
  snapshot: SourceSnapshotInfo;
  policy: BuildPolicy;
}
export function BuildSourceForm({
  disabled,
  onApprove,
  onError,
}: {
  disabled: boolean;
  onApprove: (input: SourceApprovalInput) => void;
  onError: (message: string) => void;
}) {
  return (
    <details className="panel source-approval">
      <summary>Approve a source</summary>
      <p>
        Approve reviewed input and its execution policy, then prepare the
        matching directory in your worker registry. Source code and host paths
        stay on the build host.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const form = new FormData(event.currentTarget);
            let raw: unknown;
            try {
              raw = JSON.parse(String(form.get('snapshot')));
            } catch {
              throw new Error('Paste valid source snapshot JSON.');
            }
            const snapshot = readSourceSnapshotInfo(
              raw &&
                typeof raw === 'object' &&
                'schemaVersion' in raw &&
                raw.schemaVersion === 1 &&
                'source' in raw
                ? raw.source
                : raw,
            );
            const policy = readBuildPolicy({
              image: String(form.get('image')).trim(),
              config: String(form.get('config')).trim(),
              trustPlugins: form.has('trustPlugins'),
              trustContent: form.has('trustContent'),
              limits: Object.fromEntries(
                limits.map(([key]) => [key, Number(form.get(key))]),
              ),
            });
            if (
              !snapshot.files ||
              !snapshot.bytes ||
              snapshot.bytes > policy.limits.sourceMiB * 1024 * 1024
            )
              throw new Error(
                'Inspect non-empty source input within the approved source-size limit.',
              );
            const label = String(form.get('label')).trim(),
              revision = String(form.get('revision')).trim();
            if (!label) throw new Error('Give the source a label.');
            onApprove({
              label,
              ...(revision ? { revision } : {}),
              snapshot,
              policy,
            });
          } catch (error) {
            onError(
              error instanceof Error
                ? error.message
                : 'Check the source approval fields.',
            );
          }
        }}
      >
        <div className="form-grid">
          <label>
            Source label
            <input
              name="label"
              required
              maxLength={120}
              placeholder="Platform API · release branch"
            />
          </label>
          <label>
            Source revision (optional)
            <input
              name="revision"
              maxLength={200}
              placeholder="Reviewed commit or release"
            />
          </label>
        </div>
        <label>
          Source snapshot JSON
          <textarea
            name="snapshot"
            required
            maxLength={4096}
            rows={5}
            spellCheck={false}
            aria-describedby="source-snapshot-help"
          />
        </label>
        <small id="source-snapshot-help">
          Paste the output of source-info --json, or its source object.
        </small>
        <label>
          Approved builder image
          <input
            name="image"
            required
            minLength={71}
            maxLength={512}
            placeholder="sha256:… or repository@sha256:…"
            spellCheck={false}
          />
        </label>
        <label>
          Project configuration path
          <input
            name="config"
            required
            maxLength={4096}
            defaultValue="docs.config.yaml"
            spellCheck={false}
          />
        </label>
        <div className="build-trust-controls">
          <label>
            <input type="checkbox" name="trustPlugins" />
            Allow reviewed executable plugins
          </label>
          <label>
            <input type="checkbox" name="trustContent" />
            Allow reviewed executable MDX
          </label>
        </div>
        <details>
          <summary>Resource limits</summary>
          <div className="form-grid">
            {limits.map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  name={key}
                  min={min}
                  max={max}
                  step={1}
                  defaultValue={defaultIsolatedBuildLimits[key]}
                  required
                />
              </label>
            ))}
          </div>
        </details>
        <button className="primary" disabled={disabled}>
          Approve source
        </button>
      </form>
    </details>
  );
}
