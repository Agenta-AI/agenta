/**
 * Which drives a run mounts, decided once from the request.
 *
 * The request's `drives` holds the configured entries (`AgentDrive`). This module turns them, with
 * `hasSessionDrive`, into what the runner signs, and after signing into one list of `RunDrive`
 * items that every later step reads: the mounts per backend, the links, the turn-start refresh,
 * the remount, the lease and the teardown. The session drive is not in the list: it is the working
 * folder itself, and it keeps its own fields (`mountCreds`, `mountedCwd`).
 *
 * A request without `drives` comes from an agent service older than drive sharing. It keeps the
 * old rule: the agent drive whenever the run has an artifact id.
 */
import type { AgentRunRequest, DriveAccess } from "../../protocol.ts";
import type { MountCredentials } from "./mount.ts";

/** The agent's own drive. Its credentials and mount state stay on `agentMountCreds` / `agentMountedPath`. */
export interface AgentRunDrive {
  kind: "agent";
  access: "read-write";
}

export interface ProjectRunDrive {
  kind: "project";
  slug: string;
  access: DriveAccess;
  /** Signed credentials; null when the sign failed, so the drive is not available this run. */
  credentials: MountCredentials | null;
  /** Set once the drive serves I/O in this environment; for `inprocess`, once it is a root. */
  mountedPath?: string;
}

export type RunDrive = AgentRunDrive | ProjectRunDrive;

/** What the request asks the runner to sign. */
export interface DriveSelection {
  /** The session folder is a durable drive. */
  session: boolean;
  /** The agent drive is listed (and the run has an artifact id to find it by). */
  agent: boolean;
  projects: Array<{ slug: string; access: DriveAccess }>;
}

/** A slug is used as one path segment (`drives/<slug>`, `<cwd>-project-<slug>`). */
function isSafeSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug !== "." &&
    slug !== ".." &&
    !/[/\\\0]/.test(slug)
  );
}

export function selectRunDrives(
  request: AgentRunRequest,
  log: (message: string) => void = () => {},
): DriveSelection {
  const sessionId = request.sessionId?.trim();
  const artifactId = request.runContext?.workflow?.artifact?.id?.trim();
  const entries = request.drives;
  const projects: DriveSelection["projects"] = [];
  for (const entry of entries ?? []) {
    if (entry?.kind !== "project") continue;
    if (!isSafeSlug(entry.slug)) {
      log(`project drive skipped: slug is not a single path segment`);
      continue;
    }
    if (projects.some((p) => p.slug === entry.slug)) continue;
    projects.push({
      slug: entry.slug,
      access: entry.access === "read" ? "read" : "read-write",
    });
  }
  return {
    session: request.hasSessionDrive !== false && !!sessionId,
    agent:
      !!artifactId &&
      (entries === undefined || entries.some((e) => e?.kind === "agent")),
    projects,
  };
}

/** True when the request states an empty `drives` list: no agent drive and no project drive. */
export function drivesListedEmpty(request: AgentRunRequest): boolean {
  return Array.isArray(request.drives) && request.drives.length === 0;
}

export function projectDrives(
  drives: readonly RunDrive[] | undefined,
): ProjectRunDrive[] {
  return (drives ?? []).filter(
    (d): d is ProjectRunDrive => d.kind === "project",
  );
}
