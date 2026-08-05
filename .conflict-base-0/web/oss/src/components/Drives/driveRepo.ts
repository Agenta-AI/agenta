/**
 * Git-repo facts for a drive folder, derived ENTIRELY on the frontend from the repo's own `.git`
 * metadata — no server git helper, no new endpoint. The listing hides `.git` as plumbing, but the
 * read API still serves individual `.git/*` files, so we read the handful of small TEXT files that
 * carry branch/remote/commit and parse them here (the same "derive facts from small reads" approach
 * as {@link fileMeta}). What is NOT feasible client-side is the last-commit message/author: a fresh
 * clone keeps objects in a packfile (zlib + deltas), impractical to unpack in the browser — so we
 * surface branch, remote and the HEAD short SHA, which are all plain text.
 */
import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

const SHA_RE = /^[0-9a-f]{40}$/i

export interface RepoHead {
    /** Checked-out branch, or null when HEAD is detached. */
    branch: string | null
    detached: boolean
    /** Present only when detached (HEAD is itself a SHA). */
    sha: string | null
}

/** Parse `.git/HEAD`: `ref: refs/heads/<branch>` (attached) or a bare 40-hex SHA (detached).
 * Returns null when the text is neither — i.e. this folder is not a git repo. */
export function parseHead(text: string): RepoHead | null {
    const t = text.trim()
    if (t.startsWith("ref:")) {
        const ref = t.slice(4).trim()
        return {branch: ref.replace(/^refs\/heads\//, ""), detached: false, sha: null}
    }
    if (SHA_RE.test(t)) return {branch: null, detached: true, sha: t}
    return null
}

/** The SHA for `refs/heads/<branch>` out of `.git/packed-refs` (the form a clone usually stores refs
 * in). Skips comment (`#`) and peeled-tag (`^`) lines. */
export function shaFromPackedRefs(text: string, branch: string): string | null {
    for (const raw of text.split("\n")) {
        const line = raw.trim()
        if (!line || line.startsWith("#") || line.startsWith("^")) continue
        const sp = line.indexOf(" ")
        if (sp < 0) continue
        const sha = line.slice(0, sp)
        const ref = line.slice(sp + 1).trim()
        if (ref === `refs/heads/${branch}` && SHA_RE.test(sha)) return sha
    }
    return null
}

/** Strip any embedded credentials (`https://token@host/…`, `https://user:pass@host/…`) from a
 * remote URL — a `.git/config` can carry a token in the URL and it must never reach the UI. */
export function sanitizeRemoteUrl(url: string): string {
    return url.replace(/\/\/[^/@]*@/, "//")
}

/** A compact `host/owner/repo` label from a remote URL (both `https://` and scp `git@host:owner/repo`
 * forms), credentials stripped and the trailing `.git` dropped. */
export function remoteLabel(url: string): string {
    let u = sanitizeRemoteUrl(url)
    const scp = u.match(/^[^@\s]+@([^:]+):(.+)$/) // git@github.com:owner/repo.git
    if (scp) u = `${scp[1]}/${scp[2]}`
    else u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") // drop scheme
    return u.replace(/\.git$/, "")
}

/**
 * A browsable `https://` URL for a remote, or null when it isn't web-browsable (a local path,
 * `file://`, or a host that isn't a real domain). Built ONLY from a validated host + path with a
 * HARD-CODED `https://` scheme, so an arbitrary or hostile scheme from `.git/config` (e.g. `file:`,
 * `javascript:`) can never become an href. Handles `https`/`http`/`ssh`/`git` URLs and the scp
 * `git@host:owner/repo` form; anything else (bare paths, unknown schemes, non-domain hosts) → null.
 */
export function remoteHref(url: string): string | null {
    const clean = sanitizeRemoteUrl(url).trim()
    if (!clean) return null
    let host: string
    let path: string
    const scheme = clean.match(
        /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/\s]*@)?([^:/\s]+)(?::\d+)?\/+(.+)$/i,
    )
    if (scheme) {
        // Only network schemes become links; `file:` and friends stay plain text.
        if (!["http", "https", "ssh", "git"].includes(scheme[1].toLowerCase())) return null
        host = scheme[2]
        path = scheme[3]
    } else {
        // scp form REQUIRES a `user@` (`git@host:path`) — a bare `host:path` is ambiguous with a
        // local `dir:file`, so we don't link it.
        const scp = clean.match(/^[^@/\s]+@([^:/\s]+):(.+)$/)
        if (!scp) return null
        host = scp[1]
        path = scp[2]
    }
    // Require a real domain (a dot) — rejects `localhost`, internal `server:path` scp hosts, and
    // Windows drive letters, none of which are browsable.
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)) return null
    const rel = path
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
    if (!rel || /\s/.test(rel)) return null
    return `https://${host}/${rel}`
}

export interface RepoRemote {
    /** Sanitized full URL (for a tooltip / copy). */
    url: string
    /** Compact `host/owner/repo` label (for display). */
    label: string
    /** Browsable `https://` URL when the remote resolves to a web host, else null (local/`file:`). */
    href: string | null
}

/** The `origin` remote (else the first remote) out of `.git/config`'s INI. */
export function parseRemote(cfg: string): RepoRemote | null {
    let section: string | null = null
    let originUrl: string | null = null
    let firstUrl: string | null = null
    for (const raw of cfg.split("\n")) {
        const line = raw.trim()
        const sec = line.match(/^\[(.+?)\]$/)
        if (sec) {
            section = sec[1].trim()
            continue
        }
        const m = line.match(/^url\s*=\s*(.+)$/)
        if (m) {
            const url = m[1].trim()
            if (!firstUrl) firstUrl = url
            if (section && /^remote\s+"origin"$/.test(section)) originUrl = url
        }
    }
    const url = originUrl ?? firstUrl
    return url
        ? {url: sanitizeRemoteUrl(url), label: remoteLabel(url), href: remoteHref(url)}
        : null
}

export interface RepoInfo {
    /** True once `.git/HEAD` parsed — i.e. this folder is a git repo root. */
    isRepo: boolean
    branch: string | null
    detached: boolean
    /** 7-char HEAD SHA (from the loose ref, packed-refs, or a detached HEAD). */
    shortSha: string | null
    remote: RepoRemote | null
    /** Still resolving the first probe (`.git/HEAD`). */
    loading: boolean
}

const EMPTY: RepoInfo = {
    isRepo: false,
    branch: null,
    detached: false,
    shortSha: null,
    remote: null,
    loading: false,
}

/**
 * Probe a folder for git metadata. Reads (via the shared, deduped content query) `.git/HEAD` first;
 * only if that parses as a real HEAD does it read `config` / `packed-refs` / the loose branch ref —
 * so a non-repo folder costs one tiny failed read and nothing more. Every read is gated by an empty
 * mount id (a disabled query) until the step before it has resolved, so there is no wasted traffic.
 */
export function useRepoInfo(mount: Mount | null, repoPath: string, enabled: boolean): RepoInfo {
    const mountId = enabled ? (mount?.id ?? "") : ""
    const gp = (p: string) => `${repoPath ? `${repoPath}/` : ""}.git/${p}`

    const headQ = useAtomValue(
        mountFileContentQueryFamily({mountId, path: mountId ? gp("HEAD") : ""}),
    )
    const headText = typeof headQ.data === "string" ? headQ.data : null
    const head = headText ? parseHead(headText) : null
    const isRepo = head != null
    const repoMount = isRepo ? mountId : ""
    const branch = head?.branch ?? null

    const configQ = useAtomValue(
        mountFileContentQueryFamily({mountId: repoMount, path: repoMount ? gp("config") : ""}),
    )
    // SHA sources: the loose ref file, else packed-refs. Both gated on a known branch (an attached
    // HEAD); a detached HEAD already carries the SHA.
    const refMount = branch ? repoMount : ""
    const looseQ = useAtomValue(
        mountFileContentQueryFamily({
            mountId: refMount,
            path: refMount ? gp(`refs/heads/${branch}`) : "",
        }),
    )
    const packedQ = useAtomValue(
        mountFileContentQueryFamily({mountId: refMount, path: refMount ? gp("packed-refs") : ""}),
    )

    if (!isRepo) return {...EMPTY, loading: mountId !== "" && headQ.isPending}

    const looseText = typeof looseQ.data === "string" ? looseQ.data.trim() : null
    const packedText = typeof packedQ.data === "string" ? packedQ.data : null
    let sha = head?.sha ?? null
    if (!sha && branch) {
        if (looseText && SHA_RE.test(looseText)) sha = looseText
        else if (packedText) sha = shaFromPackedRefs(packedText, branch)
    }

    return {
        isRepo: true,
        branch,
        detached: head?.detached ?? false,
        shortSha: sha ? sha.slice(0, 7) : null,
        remote: typeof configQ.data === "string" ? parseRemote(configQ.data) : null,
        loading: false,
    }
}
