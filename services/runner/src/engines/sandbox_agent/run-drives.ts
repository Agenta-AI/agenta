/**
 * Every drive a run attaches, by one code path: which drives, how each is signed, where it is
 * mounted, and the links that put it in the working folder.
 *
 * The request's `drives` lists the attached drives by slug and `homeDrive` names the one that
 * holds the agent's tools and app files. Each drive mounts beside the working folder at
 * `<cwd>-drive-<slug>` and is linked into it at `drives/<slug>`; the home drive is also linked at
 * `agent-files`. After signing, the drives become one list of `RunDrive` items that every later
 * step reads: the mounts per backend, the links, the turn-start refresh, the remount, the lease
 * and the teardown. The session drive is not in the list: it is the working folder itself, and it
 * keeps its own fields (`mountCreds`, `mountedCwd`).
 *
 * A request without `drives` comes from an older agent service, or from a configuration without
 * the key. It keeps the old rule: the agent's drive found by the artifact id through the legacy
 * sign route, mounted at `<cwd>-agent` and linked only at `agent-files`.
 */
import { constants } from "node:fs";
import { lstat, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentRunRequest, DriveAccess } from "../../protocol.ts";
import {
  ensureDurableSymlink,
  type EnsureDurableSymlinkDeps,
} from "./durable-symlink.ts";
import {
  shellQuote,
  type MountCredentials,
  type SandboxExec,
  type SignMountDeps,
} from "./mount.ts";
import { throwIfAcquireAborted } from "../../environment/acquire-abort.ts";

/** The folder in the working folder that holds one link per drive, and the README. */
export const DRIVES_DIR_NAME = "drives";
/** The link to the home drive in the working folder. */
export const HOME_DRIVE_LINK_NAME = "agent-files";
export const DRIVES_README_PATH = `${DRIVES_DIR_NAME}/README.md`;
export const HOME_README_NAME = "README.md";
export const HOME_README_CONTENT = `This folder belongs to your agent.
Files here persist across all sessions and runs of this agent.
Your working directory persists only for the current session.
Without a session, the working directory does not persist.
Concurrent runs share this folder, so the last writer wins for each file.
Tools you keep under .tools/ (static binaries in .tools/bin/, and a .tools/setup.sh that
rebuilds environments on local disk) are restored before each session starts.
`;

export interface RunDrive {
  /** The drive's slug; absent only for the legacy agent drive, found by `artifactId`. */
  slug?: string;
  /** Set only for the legacy agent drive. */
  artifactId?: string;
  access: DriveAccess;
  /** The home drive: linked at `agent-files`, holds `.tools/` and the README. */
  isHome: boolean;
  /** Signed credentials; null when the sign failed, so the drive is not available this run. */
  credentials: MountCredentials | null;
  /** Set once the drive serves I/O in this environment; for `inprocess`, once it is a root. */
  mountedPath?: string;
  /**
   * The acquire made the drive's links (`local`, `daytona`). Without them the drive is mounted but
   * not available to the model. `inprocess` links in its command sandbox instead.
   */
  linked?: boolean;
}

/** What the request asks the runner to sign. */
export interface DriveSelection {
  /** The session folder is a durable drive. */
  session: boolean;
  /** No `drives` on the request: sign the agent's drive by the artifact id (legacy route). */
  legacyAgentDrive: boolean;
  drives: Array<{ slug: string; access: DriveAccess; isHome: boolean }>;
}

/** A slug is used as one path segment (`drives/<slug>`, `<cwd>-drive-<slug>`). */
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
  const drives: DriveSelection["drives"] = [];
  for (const entry of entries ?? []) {
    if (!isSafeSlug(entry?.slug)) {
      log(`drive skipped: slug is not a single path segment`);
      continue;
    }
    if (drives.some((d) => d.slug === entry.slug)) continue;
    const access: DriveAccess = entry.access === "read" ? "read" : "read-write";
    drives.push({
      slug: entry.slug,
      access,
      isHome: request.homeDrive === entry.slug && access === "read-write",
    });
  }
  if (typeof request.homeDrive === "string" && !drives.some((d) => d.isHome)) {
    log(`home drive skipped: slug=${request.homeDrive} is not a read-write entry of drives`);
  }
  return {
    session: request.hasSessionDrive !== false && !!sessionId,
    legacyAgentDrive: !!artifactId && entries === undefined,
    drives,
  };
}

/** True when the request states an empty `drives` list: no drive at all. */
export function drivesListedEmpty(request: AgentRunRequest): boolean {
  return Array.isArray(request.drives) && request.drives.length === 0;
}

export function homeDrive(
  drives: readonly RunDrive[] | undefined,
): RunDrive | undefined {
  return drives?.find((d) => d.isHome);
}

/** The drive serves files at its links in the working folder (on `inprocess`, once it is a root). */
export function driveAvailable(drive: RunDrive): boolean {
  return !!drive.mountedPath && drive.linked !== false;
}

/**
 * The home drive's state for the prompt: its path when it serves files at `agent-files`,
 * `"unavailable"` when the run has one that could not be signed, mounted or linked, and undefined
 * when the run has none.
 */
export function homeDriveStatus(
  drives: readonly RunDrive[] | undefined,
): { path: string } | "unavailable" | undefined {
  const home = homeDrive(drives);
  if (!home) return undefined;
  return driveAvailable(home) ? { path: home.mountedPath! } : "unavailable";
}

export function driveMountPath(cwd: string, slug: string): string {
  return `${cwd}-drive-${slug}`;
}

/** Where `drive` mounts. The legacy agent drive keeps its old path. */
export function runDriveMountPath(cwd: string, drive: RunDrive): string {
  return drive.slug ? driveMountPath(cwd, drive.slug) : `${cwd}-agent`;
}

/** `kind=` in the degrade log lines: `drive_mount`, or `agent_mount` on the legacy path. */
export function driveLogKind(drive: RunDrive): string {
  return drive.slug ? "drive_mount" : "agent_mount";
}

/** Names the drive in log lines. */
export function driveSubject(drive: RunDrive): string {
  return drive.slug ? `slug=${drive.slug}` : `artifact=${drive.artifactId}`;
}

/** The links that name `drive` in the working folder, relative to it. */
export function driveLinkNames(drive: RunDrive): string[] {
  return [
    ...(drive.slug ? [`${DRIVES_DIR_NAME}/${drive.slug}`] : []),
    ...(drive.isHome ? [HOME_DRIVE_LINK_NAME] : []),
  ];
}

function defaultLog(msg: string): void {
  process.stderr.write(`[sandbox_agent/run-drives] ${msg}\n`);
}

function detail(err: unknown, max = 200): string {
  return String(err instanceof Error ? err.message : err).slice(0, max);
}

// ---- Signing ------------------------------------------------------------------------------- //

/**
 * Call one mounts sign route, bounded to 10 s so a hung endpoint fails open (null) instead of
 * stalling the acquire. `subject` names the drive in log lines.
 */
async function signMountCredentialsAt(
  request: { url: string; method: "POST" },
  subject: string,
  deps: SignMountDeps,
): Promise<MountCredentials | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutSignal = AbortSignal.timeout(10_000);
  const signal = deps.signal
    ? AbortSignal.any([deps.signal, timeoutSignal])
    : timeoutSignal;
  try {
    const res = await doFetch(request.url, {
      method: request.method,
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      signal,
    });
    if (!res.ok) {
      log(`sign HTTP ${res.status} ${subject} — running without this mount`);
      return null;
    }
    const body = (await res.json()) as {
      mount?: { id?: string; project_id?: string };
      credentials?: {
        endpoint?: string;
        region?: string;
        bucket?: string;
        prefix?: string;
        access_key?: string;
        secret_key?: string;
        session_token?: string;
        expires_at?: string;
      };
    };
    const c = body.credentials;
    if (!c?.bucket || !c.prefix || !c.access_key || !c.secret_key) {
      log(`sign returned no usable credentials ${subject}`);
      return null;
    }
    return {
      endpoint: c.endpoint,
      region: c.region ?? "us-east-1",
      bucket: c.bucket,
      prefix: c.prefix,
      accessKey: c.access_key,
      secretKey: c.secret_key,
      sessionToken: c.session_token,
      expiresAt: c.expires_at,
      projectId:
        typeof body.mount?.project_id === "string"
          ? body.mount.project_id
          : undefined,
      mountId: typeof body.mount?.id === "string" ? body.mount.id : undefined,
    };
  } catch (err) {
    throwIfAcquireAborted(deps.signal);
    log(`sign failed ${subject}: ${detail(err, 160)}`);
    return null;
  }
}

/**
 * Sign a drive by its slug. `isHome` asks the API to apply the home rule too; its refusal
 * (403 `home_drive_not_allowed`) means no home for this run. Returns null on any refusal or failure:
 * the run then goes on without that drive.
 */
export async function signMountCredentialsBySlug(
  slug: string,
  access: DriveAccess,
  isHome: boolean,
  deps: SignMountDeps,
): Promise<MountCredentials | null> {
  const query = `slug=${encodeURIComponent(slug)}&access=${encodeURIComponent(access)}${isHome ? "&is_home=true" : ""}`;
  return signMountCredentialsAt(
    { url: `${deps.apiBase}/mounts/sign?${query}`, method: "POST" },
    `slug=${slug} access=${access}${isHome ? " home" : ""}`,
    deps,
  );
}

/** The legacy route: the agent's drive found by the artifact id, for a request without `drives`. */
export async function signAgentMountCredentials(
  artifactId: string,
  deps: SignMountDeps,
  name: string = "default",
): Promise<MountCredentials | null> {
  return signMountCredentialsAt(
    {
      url: `${deps.apiBase}/mounts/agents/sign?artifact_id=${encodeURIComponent(artifactId)}&name=${encodeURIComponent(name)}`,
      method: "POST",
    },
    `artifact=${artifactId} name=${name}`,
    deps,
  );
}

/** Sign `drive` again, by the route it was first signed with. */
export function signRunDrive(
  drive: RunDrive,
  deps: SignMountDeps,
  signers: {
    signBySlug: typeof signMountCredentialsBySlug;
    signAgent: typeof signAgentMountCredentials;
  },
): Promise<MountCredentials | null> {
  return drive.slug
    ? signers.signBySlug(drive.slug, drive.access, drive.isHome, deps)
    : signers.signAgent(drive.artifactId!, deps);
}

// ---- Links --------------------------------------------------------------------------------- //

/**
 * Make `<cwd>/drives` a real folder when it is missing. False when something else is there: a link
 * there could lead out of the working folder, so nothing under `drives/` is touched through it.
 */
async function ensureDrivesDir(
  cwd: string,
  deps: { lstat?: typeof lstat; mkdir?: typeof mkdir },
): Promise<boolean> {
  const dir = join(cwd, DRIVES_DIR_NAME);
  await (deps.mkdir ?? mkdir)(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "EEXIST") throw err;
  });
  return (await (deps.lstat ?? lstat)(dir)).isDirectory();
}

/** True when `<cwd>/drives` is a real folder (not a link). */
async function isDrivesDir(cwd: string): Promise<boolean> {
  return lstat(join(cwd, DRIVES_DIR_NAME)).then(
    (st) => st.isDirectory(),
    () => false,
  );
}

/**
 * Point `<cwd>/<name>` at `target`. Re-run on every turn: the link lives on the session folder,
 * where geesefs turns a symlink into an empty file across a remount.
 *
 * A real folder, or a file with content, at the link path holds what was written there while the
 * link was missing. It is never deleted or moved: the link fails, and the drive is not available
 * there until a person clears it.
 */
async function linkInCwd(
  cwd: string,
  name: string,
  target: string,
  deps: EnsureDurableSymlinkDeps & { mkdir?: typeof mkdir },
  log: (msg: string) => void,
): Promise<boolean> {
  const linkPath = join(cwd, name);
  try {
    if (name.includes("/") && !(await ensureDrivesDir(cwd, deps))) {
      log(`${DRIVES_DIR_NAME} is not a folder in ${cwd}; ${name} not linked`);
      return false;
    }
    const existing = await (deps.lstat ?? lstat)(linkPath).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return undefined;
        throw err;
      },
    );
    // Checked here, not left to `ensureDurableSymlink`, which removes an empty folder.
    if (existing?.isDirectory()) {
      log(`${name} is a folder in ${cwd}; not replaced`);
      return false;
    }
    // An empty file is what geesefs leaves of a link after a remount; a file with content is someone's.
    if (existing?.isFile() && existing.size > 0) {
      log(`${name} is a file with content in ${cwd}; not replaced`);
      return false;
    }
  } catch (err) {
    log(`${name} check failed in ${cwd}: ${detail(err)}`);
    return false;
  }
  const outcome = await ensureDurableSymlink(linkPath, target, name, { ...deps, log });
  return outcome !== "failed";
}

/** Make every link of `drive` in `cwd`. Returns whether all of them are in place. */
export async function linkRunDrive(
  cwd: string,
  drive: RunDrive,
  mountPath: string,
  deps: EnsureDurableSymlinkDeps & { mkdir?: typeof mkdir } = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  let ok = true;
  for (const name of driveLinkNames(drive)) {
    if (!(await linkInCwd(cwd, name, mountPath, deps, log))) ok = false;
  }
  if (!ok) log(`mount degraded kind=${driveLogKind(drive)} cause=link_failed ${driveSubject(drive)}`);
  return ok;
}

/** Remove the links of `drive` from `cwd` when they are links; anything else there stays. */
export async function unlinkRunDrive(
  cwd: string,
  drive: RunDrive,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const drivesDir = await isDrivesDir(cwd);
  for (const name of driveLinkNames(drive)) {
    if (name.includes("/") && !drivesDir) continue;
    try {
      if ((await lstat(join(cwd, name))).isSymbolicLink()) await unlink(join(cwd, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log(`${name} not removed: ${detail(err, 160)}`);
      }
    }
  }
}

/**
 * A shell check that `<cwd>/drives` is a real folder, made when missing. A link there could lead out
 * of the working folder, so the script stops.
 */
function drivesDirScript(cwd: string): string {
  const dir = shellQuote(join(cwd, DRIVES_DIR_NAME));
  return `{ [ ! -L ${dir} ] && mkdir -p ${dir} && [ -d ${dir} ] && [ ! -L ${dir} ]; }`;
}

/** The same link, made inside a remote sandbox, with the same rule for what is at the link path. */
export async function linkDriveRemote(
  sandbox: SandboxExec,
  cwd: string,
  name: string,
  target: string,
): Promise<boolean> {
  const link = shellQuote(join(cwd, name));
  const res = await sandbox.runProcess({
    command: "sh",
    args: [
      "-c",
      `${name.includes("/") ? `${drivesDirScript(cwd)} && ` : ""}{ [ "$(readlink ${link} 2>/dev/null)" = ${shellQuote(target)} ] || { { [ -L ${link} ] || { [ ! -d ${link} ] && [ ! -s ${link} ]; }; } && rm -f ${link} && ln -s ${shellQuote(target)} ${link}; }; }`,
    ],
    timeoutMs: 30_000,
  });
  return res?.exitCode === 0;
}

/** Make every link of `drive` inside a remote sandbox. Returns whether all of them are in place. */
export async function linkRunDriveRemote(
  sandbox: SandboxExec,
  cwd: string,
  drive: RunDrive,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  let ok = true;
  for (const name of driveLinkNames(drive)) {
    try {
      if (!(await linkDriveRemote(sandbox, cwd, name, mountPath))) {
        log(`remote ${name} link failed in ${cwd}`);
        ok = false;
      }
    } catch (err) {
      log(`remote ${name} link failed in ${cwd}: ${detail(err)}`);
      ok = false;
    }
  }
  if (!ok) log(`mount degraded kind=${driveLogKind(drive)} cause=link_failed ${driveSubject(drive)}`);
  return ok;
}

/**
 * What the prune keeps: the `drives/<slug>` of every mounted drive, and `agent-files` when the home
 * drive is mounted. `slugs` is null on the legacy path (a request without `drives`): the runner
 * does not own `drives/` there, so nothing under it is removed.
 */
export interface KeptLinks {
  slugs: readonly string[] | null;
  home: boolean;
}

/**
 * The prune's input for a run's drive list, read after the mounts settle. A drive that could not
 * be signed or mounted is not available, so its links go: a link left behind could still open an
 * earlier mount of that drive.
 */
export function keptLinks(drives: readonly RunDrive[], listed: boolean): KeptLinks {
  const mounted = drives.filter((d) => d.mountedPath);
  return {
    slugs: listed ? mounted.flatMap((d) => (d.slug ? [d.slug] : [])) : null,
    home: mounted.some((d) => d.isHome),
  };
}

/** A link, or the empty file geesefs leaves of one. */
function isLinkResidue(st: { isSymbolicLink(): boolean; isFile(): boolean; size: number }): boolean {
  return st.isSymbolicLink() || (st.isFile() && st.size === 0);
}

/**
 * Remove leftover links: `drives/<entry>` items the list no longer holds, and `agent-files` when the
 * run has no home. Only a link, or the empty file geesefs leaves of one, is removed; a folder or a
 * file with content (`drives/README.md` included) is someone's and stays.
 */
export async function pruneDriveLinks(
  cwd: string,
  keep: KeptLinks,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const candidates: string[] = [];
  const slugs = keep.slugs;
  // Never through a link at `drives`: its entries would be outside the working folder.
  if (slugs && (await isDrivesDir(cwd))) {
    try {
      for (const entry of await readdir(join(cwd, DRIVES_DIR_NAME))) {
        if (!slugs.includes(entry)) candidates.push(`${DRIVES_DIR_NAME}/${entry}`);
      }
    } catch {
      // Unreadable `drives/` folder: nothing to prune there.
    }
  }
  if (!keep.home) candidates.push(HOME_DRIVE_LINK_NAME);
  for (const name of candidates) {
    const path = join(cwd, name);
    try {
      if (!isLinkResidue(await lstat(path))) continue;
      await unlink(path);
      log(`removed stale ${name}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      log(`stale ${name} not removed: ${detail(err, 160)}`);
    }
  }
}

/** The same cleanup inside a remote sandbox. */
export async function pruneDriveLinksRemote(
  sandbox: SandboxExec,
  cwd: string,
  keep: KeptLinks,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const residue = (e: string) => `{ [ -L ${e} ] || { [ -f ${e} ] && [ ! -s ${e} ]; }; }`;
  const script =
    `cd ${shellQuote(cwd)} 2>/dev/null || exit 0; keep_home="$1"; prune_drives="$2"; shift 2; ` +
    `if [ "$keep_home" != 1 ] && ${residue(HOME_DRIVE_LINK_NAME)}; then rm -f ${HOME_DRIVE_LINK_NAME} && echo ${HOME_DRIVE_LINK_NAME}; fi; ` +
    `[ "$prune_drives" = 1 ] && [ ! -L ${DRIVES_DIR_NAME} ] && cd ${DRIVES_DIR_NAME} 2>/dev/null || exit 0; ` +
    `for e in * .[!.]*; do [ -e "$e" ] || [ -L "$e" ] || continue; ` +
    `k=0; for s in "$@"; do [ "$s" = "$e" ] && k=1; done; [ "$k" = 1 ] && continue; ` +
    `if ${residue('"$e"')}; then rm -f "$e" && echo "${DRIVES_DIR_NAME}/$e"; fi; done`;
  try {
    const res = (await sandbox.runProcess({
      command: "sh",
      args: ["-c", script, "sh", keep.home ? "1" : "0", keep.slugs ? "1" : "0", ...(keep.slugs ?? [])],
      timeoutMs: 30_000,
    })) as { exitCode?: number; result?: string; stdout?: string } | undefined;
    const removed = String(res?.result ?? res?.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const name of removed) log(`removed stale ${name}`);
  } catch (err) {
    log(`stale drive links cleanup failed in ${cwd}: ${detail(err, 160)}`);
  }
}

// ---- READMEs ------------------------------------------------------------------------------- //

/**
 * The text of `drives/README.md`: the drives mounted in this run, with their access, for the
 * agent and for the person who opens the files pane.
 */
export function drivesReadme(drives: readonly RunDrive[]): string {
  const rows = drives
    .filter((d) => d.slug && driveAvailable(d))
    .map(
      (d) =>
        `| ${DRIVES_DIR_NAME}/${d.slug}/ | ${d.access === "read" ? "read only" : "read and write"} | ${d.isHome ? `Home drive. Also at ${HOME_DRIVE_LINK_NAME}/.` : ""} |`,
    );
  const list = rows.length
    ? ["| Folder | Access | Note |", "| --- | --- | --- |", ...rows].join("\n")
    : "No drives are attached to this agent.";
  return `# Drives

Each folder here is a drive: a folder of files that Agenta keeps after this
conversation ends. This list comes from the agent's configuration.

${list}

Other agents with access to a drive may also write files in it. If two
agents write the same file, the last write wins.

Agenta writes this file again at the start of every conversation. Changes to
it are not kept.
`;
}

/** Write `drives/README.md` in `cwd`, never through a link. Never throws. */
export async function writeDrivesReadme(
  cwd: string,
  content: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  try {
    if (!(await ensureDrivesDir(cwd, {}))) {
      (deps.log ?? defaultLog)(`${DRIVES_README_PATH} not written in ${cwd}: ${DRIVES_DIR_NAME} is not a folder`);
      return;
    }
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
    await writeFile(join(cwd, DRIVES_README_PATH), content, { flag: flags });
  } catch (err) {
    (deps.log ?? defaultLog)(`${DRIVES_README_PATH} not written in ${cwd}: ${detail(err)}`);
  }
}

/** Write `drives/README.md` inside a remote sandbox, never through a link. Never throws. */
export async function writeDrivesReadmeRemote(
  sandbox: SandboxExec,
  cwd: string,
  content: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `${drivesDirScript(cwd)} && [ ! -L ${shellQuote(join(cwd, DRIVES_README_PATH))} ] && printf %s ${shellQuote(content)} > ${shellQuote(join(cwd, DRIVES_README_PATH))}`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) log(`remote ${DRIVES_README_PATH} not written in ${cwd}: exit ${res?.exitCode}`);
  } catch (err) {
    log(`remote ${DRIVES_README_PATH} not written in ${cwd}: ${detail(err)}`);
  }
}

/** Seed the home drive's README when it has none; an agent-edited README is kept. */
export async function seedHomeReadme(
  mountPath: string,
  deps: { writeFile?: typeof writeFile; log?: (msg: string) => void } = {},
): Promise<void> {
  const readmePath = join(mountPath, HOME_README_NAME);
  try {
    // `wx` makes concurrent first-run seeds atomic without overwriting an agent-edited README.
    await (deps.writeFile ?? writeFile)(readmePath, HOME_README_CONTENT, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      (deps.log ?? defaultLog)(`README seed failed ${readmePath}: ${detail(err)}`);
    }
  }
}

/** The same seed inside a remote sandbox. */
export async function seedHomeReadmeRemote(
  sandbox: SandboxExec,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const readmePath = join(mountPath, HOME_README_NAME);
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        // `set -C` makes the write fail on a README another run created after the check, as `wx` does.
        `set -C; [ -e ${shellQuote(readmePath)} ] || [ -L ${shellQuote(readmePath)} ] || printf %s ${shellQuote(HOME_README_CONTENT)} 2>/dev/null > ${shellQuote(readmePath)} || [ -e ${shellQuote(readmePath)} ]`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) log(`remote README seed failed ${readmePath}: exit ${res?.exitCode}`);
  } catch (err) {
    log(`remote README seed failed ${readmePath}: ${detail(err)}`);
  }
}

/**
 * Sign again, all at once, every drive this environment holds credentials for, the home drive
 * included, and return the subjects (`driveSubject`) of the ones that no longer sign. A thrown sign
 * counts as failed. A drive whose first sign failed holds no credentials and is skipped.
 */
export async function unsignableDrives(
  drives: readonly RunDrive[] | undefined,
  sign: (drive: RunDrive) => Promise<MountCredentials | null>,
): Promise<string[]> {
  const held = (drives ?? []).filter((d) => d.credentials);
  const signed = await Promise.all(held.map((d) => sign(d).catch(() => null)));
  return held.filter((_, i) => !signed[i]).map(driveSubject);
}
