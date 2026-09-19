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

/**
 * The presented drive path an href inside `fromPath` names, or null when the link is the browser's.
 * A leading `/` is the drive root; `?query` and `#fragment` tails are dropped; percent-encoding is
 * undone (an editor may encode a space that the file name carries raw).
 */
export const resolveDriveLink = (
    href: string | null | undefined,
    fromPath: string,
): string | null => {
    if (!href) return null
    const trimmed = href.trim()
    if (!trimmed || isExternalDriveHref(trimmed)) return null
    let target = trimmed.split(/[?#]/)[0]
    try {
        target = decodeURIComponent(target)
    } catch {
        // Not encoded, or not validly: the raw spelling is the name.
    }
    if (!target) return null
    const dir = fromPath.includes("/") ? fromPath.split("/").slice(0, -1).join("/") : ""
    const resolved = target.startsWith("/")
        ? resolveRelativePath("", target)
        : resolveRelativePath(dir, target)
    return resolved || null
}
