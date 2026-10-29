/**
 * Where a link inside a drive file points. A markdown or HTML file in the drive links to its
 * neighbours the way files do on disk — `notes.md`, `./img/a.png`, `../README.md` — and a click on
 * one should open THAT file in the pane, not hand the relative path to the browser (which resolves
 * it against the app's URL and lands on a blank tab). The test is the href's shape alone, no
 * lookup: a `scheme:` URL, a `//host`, a `#fragment` or `mailto:` is the browser's; anything else
 * is a path, resolved against the linking file's folder.
 */

/** A URL the browser owns: a scheme, a protocol-relative host, or a same-page fragment. */
export const isExternalDriveHref = (href: string): boolean =>
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.replace(/\\/g, "/").startsWith("//") ||
    href.startsWith("#")

/** Resolve a relative path against a folder, folding `.` and `..` (never above the root). */
export const resolveRelativePath = (dir: string, rel: string): string => {
    const out: string[] = []
    for (const seg of (dir ? dir.split("/") : []).concat(rel.split("/"))) {
        if (seg === "" || seg === ".") continue
        if (seg === "..") out.pop()
        else out.push(seg)
    }
    return out.join("/")
}

/** The bare path an href names, or null when the link is the browser's: `?query` and `#fragment`
 * tails dropped, percent-encoding undone (an editor may encode a space the file name carries raw). */
const linkTarget = (href: string | null | undefined): string | null => {
    if (!href) return null
    const trimmed = href.trim()
    if (!trimmed || isExternalDriveHref(trimmed)) return null
    let target = trimmed.split(/[?#]/)[0]
    try {
        target = decodeURIComponent(target)
    } catch {
        // Not encoded, or not validly: the raw spelling is the name.
    }
    return target || null
}

/** One reading of a link: the path it names, and the folder its first segment lands in (`head`),
 * which a lazily loaded tree knows even when the leaf isn't loaded yet. */
export interface DriveLinkCandidate {
    path: string
    head: string
}

/**
 * The readings of an href inside `fromPath`, most likely first, or `[]` when the link is the
 * browser's. A file links to its neighbours two ways: markdown's, relative to the FILE's folder
 * (`notes.md` beside it, `./img/a.png`, `../README.md`), and the agent's, relative to its working
 * directory, which is the drive's root (`attachments/<id>/photo.png` written from inside
 * `agent-files/`). An explicit `./` or `../` is the first; a leading `/` is the root; a bare path
 * is either, so both come back and the caller picks the one it knows.
 */
export const driveLinkCandidates = (
    href: string | null | undefined,
    fromPath: string,
): DriveLinkCandidate[] => {
    const target = linkTarget(href)
    if (!target) return []
    const from = (base: string): DriveLinkCandidate | null => {
        const path = resolveRelativePath(base, target)
        const first = target.replace(/^(\.\.?\/)+/, "").split("/")[0]
        return path ? {path, head: first ? resolveRelativePath(base, first) : path} : null
    }
    if (target.startsWith("/")) return [from("")].filter((c): c is DriveLinkCandidate => c !== null)
    const dir = fromPath.includes("/") ? fromPath.split("/").slice(0, -1).join("/") : ""
    const explicit = target.startsWith("./") || target.startsWith("../")
    const readings = explicit || !dir ? [from(dir)] : [from(dir), from("")]
    return readings.filter(
        (c, i, all): c is DriveLinkCandidate =>
            c !== null && all.findIndex((o) => o?.path === c.path) === i,
    )
}

/**
 * The presented drive path an href inside `fromPath` names, or null when the link is the browser's.
 * With `exists` (a lookup into the tree already in memory — never a fetch), a bare path picks the
 * reading the tree knows: the path itself, or its head folder when the leaf isn't loaded yet.
 * Without it, or when neither is known, markdown's file-relative reading wins.
 */
export const resolveDriveLink = (
    href: string | null | undefined,
    fromPath: string,
    exists?: (path: string) => boolean,
): string | null => {
    const candidates = driveLinkCandidates(href, fromPath)
    if (!candidates.length) return null
    const known = exists ? candidates.find((c) => exists(c.path) || exists(c.head)) : undefined
    return (known ?? candidates[0]).path
}
