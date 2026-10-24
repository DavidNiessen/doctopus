import type { ProjectCapabilities } from '@davidniessen/doctopus-domain';

export function readProjectCapabilities(
  value: unknown,
  projectId: string,
): ProjectCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid project permissions. Refresh to try again.');
  const input = value as Record<string, unknown>;
  if (
    input.projectId !== projectId ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(projectId) ||
    typeof input.publish !== 'boolean' ||
    typeof input.manageAccess !== 'boolean' ||
    typeof input.readAudit !== 'boolean'
  )
    throw new Error('Invalid project permissions. Refresh to try again.');
  return {
    projectId,
    publish: input.publish,
    manageAccess: input.manageAccess,
    readAudit: input.readAudit,
  };
}
