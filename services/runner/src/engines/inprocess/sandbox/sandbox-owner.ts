/**
 * Who created a command sandbox, as two labels on it: the runner process (`OWNER_LABEL`) and the
 * deployment (`DEPLOYMENT_LABEL`). They are for people and audits; nothing deletes by them.
 *
 * A runner uses only the sandboxes it created. A sandbox whose runner died holds nothing durable
 * (the drive, in object storage, is the only copy of the files), so it is left to Daytona's own
 * stop and delete intervals, set at create from the `daytona` provider's settings.
 */
import { createHash } from "node:crypto";

/** The label naming the runner process that created a sandbox. */
export const OWNER_LABEL = "agenta.owner";
/** The label naming the deployment a sandbox belongs to. */
export const DEPLOYMENT_LABEL = "agenta.deployment";

export interface SandboxOwner {
  /** This runner process. */
  id: string;
  /** The deployment: a digest of its API address, so the label names no host. */
  deployment: string;
}

export function sandboxOwner(replicaId: string, apiBase: string): SandboxOwner {
  return { id: replicaId, deployment: createHash("sha256").update(apiBase).digest("hex").slice(0, 16) };
}
