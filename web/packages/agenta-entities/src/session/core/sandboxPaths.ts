/**
 * Sandbox path → drive path. The runner mounts a session's durable cwd at
 * `<base>/agenta/mounts/<project_id>/<mount_id>` (`/tmp/…` locally, `/home/sandbox/…` on Daytona)
 * and the agent's own mount at the `-agent` sibling of that directory, which the drive presents
 * folded under `agent-files/`.
 *
 * An agent names files by their SANDBOX path, so every surface that resolves a mention against a
 * mount listing has to map one to the other first — a listing path is mount-root-relative, and a
 * sandbox path compared to it resolves to nothing.
 */
import {stripTrailingSlashes} from "./pathUtils"

/** The agent mount's fold point inside the session cwd (runner: `AGENT_FILES_LINK_NAME`). */
export const AGENT_FILES_DIR = "agent-files"

/** The directory suffix the runner gives the agent mount (`<cwd>-agent`). */
const AGENT_MOUNT_SUFFIX = "-agent"

/**
 * The drive-presented path a sandbox-absolute path names, or `null` when it isn't one — a path
 * outside the mounts (`/etc/hosts`) and a relative mention both return `null`, since neither needs
 * mapping. The mount root itself maps to `""`.
 *
 * Segment-walked rather than matched with a regex: the mount prefix is backend-supplied and an
 * end-anchored quantifier over it backtracks quadratically (the polynomial-ReDoS the sibling path
 * helpers already avoid).
 */
export function toolPathToDrivePath(toolPath: string): string | null {
    if (!toolPath.startsWith("/")) return null
    const segments = stripTrailingSlashes(toolPath).split("/")
    for (let i = 0; i + 3 < segments.length; i++) {
        if (segments[i] !== "agenta" || segments[i + 1] !== "mounts") continue
        const rest = segments.slice(i + 4).join("/")
        if (!segments[i + 3].endsWith(AGENT_MOUNT_SUFFIX)) return rest
        return rest ? `${AGENT_FILES_DIR}/${rest}` : AGENT_FILES_DIR
    }
    return null
}

/** Does this path point inside the session cwd / agent mount the drive shows? */
export const isSandboxPath = (path: string): boolean => toolPathToDrivePath(path) !== null
