/**
 * Sandbox path → drive path. Agents name files by their sandbox path, but a mount listing is
 * mount-root-relative, so the two never match until one is mapped. The runner mounts the session
 * cwd at `<base>/agenta/[<namespace>/]mounts/<project_id>/<mount_id>` and the agent's own mount at
 * that directory's `-agent` sibling, which the drive folds under `agent-files/`.
 */
import {stripTrailingSlashes} from "./pathUtils"

/** The agent mount's fold point inside the session cwd (runner: `AGENT_FILES_LINK_NAME`). */
export const AGENT_FILES_DIR = "agent-files"

/** The directory suffix the runner gives the agent mount (`<cwd>-agent`). */
const AGENT_MOUNT_SUFFIX = "-agent"

/**
 * The drive-presented path a sandbox-absolute path names, or `null` when it isn't one (`/etc/hosts`
 * and relative mentions need no mapping). The mount root itself maps to `""`.
 *
 * Segment-walked, not regex-matched: an end-anchored quantifier over a backend-supplied prefix
 * backtracks quadratically (the polynomial-ReDoS the sibling path helpers avoid). `mounts` is
 * located rather than assumed to follow `agenta`, because a deploy-time store namespace sits
 * between the two (api `MountsService._storage_key`).
 */
export function toolPathToDrivePath(toolPath: string): string | null {
    if (!toolPath.startsWith("/")) return null
    const segments = stripTrailingSlashes(toolPath).split("/")
    const agenta = segments.indexOf("agenta")
    if (agenta === -1) return null
    const mounts = segments.indexOf("mounts", agenta + 1)
    // Needs a project AND a mount segment after `mounts` to name a drive.
    if (mounts === -1 || mounts + 2 >= segments.length) return null
    const rest = segments.slice(mounts + 3).join("/")
    if (!segments[mounts + 2].endsWith(AGENT_MOUNT_SUFFIX)) return rest
    return rest ? `${AGENT_FILES_DIR}/${rest}` : AGENT_FILES_DIR
}

/** Does this path point inside the session cwd / agent mount the drive shows? */
export const isSandboxPath = (path: string): boolean => toolPathToDrivePath(path) !== null
