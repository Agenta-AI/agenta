/**
 * `rehype-harden`, the last plugin in Streamdown's rehype pipeline, drops any anchor whose href it
 * cannot parse: a relative target parses only when it starts with `/`, `./` or `../`, so the bare
 * form the platform prompt prescribes rendered as inert "[blocked]" text (#6659). Respelling the
 * href is all this module does. `rehype-sanitize`, upstream of it, is what strips a dangerous
 * scheme, and harden still gates every href this module rewrites.
 *
 * It also owns the one shape harden lets through that it should not: a target that resolves to a
 * host instead of a path. See {@link isProtocolRelativeHref}, which the chat anchor calls first.
 */

/** True for a `scheme:` URL, a protocol-relative `//host` or a `#fragment`; false for a path. */
export const isExternalHref = (href?: string): boolean =>
    !href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

/**
 * What the URL parser sees. It removes every ASCII tab, newline and carriage return from the whole
 * input, then ignores leading and trailing C0 controls and spaces. So `/<tab>/host` is `//host` to a
 * browser, and this has to be the shape the checks below run on.
 */
const asBrowserReadsIt = (value: string): string => {
    const stripped = value.replace(/[\t\n\r]/g, "")
    let start = 0
    let end = stripped.length
    while (start < end && stripped[start] <= " ") start += 1
    while (end > start && stripped[end - 1] <= " ") end -= 1
    return stripped.slice(start, end)
}

/** Resolving against this tells a same-document path apart from one that names another host. */
const PROBE_ORIGIN = "http://link-gate.invalid"
const PROBE_HOST = "link-gate.invalid"

/**
 * True when a browser would read this href as naming a HOST rather than a path in this app (#6666).
 *
 * The escape harden leaves open: it parses a target that starts with `../`, then emits
 * `parsedUrl.pathname`, and the pathname of `..//evil.com/x` is `//evil.com/x`. That is a
 * protocol-relative URL, so the browser fills in the page's scheme and navigates off-site under a
 * link text the markdown author chose. Model output is markdown an agent can be steered into
 * writing, so the anchor refuses the shape instead of trusting the target.
 *
 * The test is deliberately wider than a literal `//` prefix, because several spellings reach the
 * same place. A browser reads a backslash as a slash in an http(s) URL, so `/\host` is `//host`.
 * Percent-encoding hides the slashes from a prefix test but not from the browser, so the check
 * decodes until the value stops changing. Tabs, newlines and surrounding controls are dropped by
 * the URL parser, so {@link asBrowserReadsIt} drops them here first. And a target harden did not
 * resolve can still resolve to another host, so the last step resolves it and compares.
 *
 * A `scheme:` URL is not this function's business and returns false: `rehype-sanitize` drops a
 * dangerous scheme and `rehype-harden` gates the rest, and an `https://` link is a link a reply is
 * allowed to contain. The cost of the rule is a legitimate `//host` spelling of a web link in a
 * reply, which renders blocked. That trade is the decision recorded on #6666.
 */
export const isProtocolRelativeHref = (href?: string | null): boolean => {
    if (typeof href !== "string" || !href) return false
    let value = href
    // Four rounds covers `%252f`-style double encoding with room to spare. The loop stops as soon
    // as decoding is a no-op, so an ordinary path costs one pass.
    for (let round = 0; round < 4; round += 1) {
        value = asBrowserReadsIt(value)
        if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
        if (value.replace(/\\/g, "/").startsWith("//")) return true
        let decoded: string
        try {
            decoded = decodeURIComponent(value)
        } catch {
            break
        }
        if (decoded === value) break
        value = decoded
    }
    try {
        const url = new URL(value.replace(/\\/g, "/"), PROBE_ORIGIN)
        // A different host means the target named one. A pathname that still starts with `//` is
        // the shape harden hands back, which the NEXT resolution (the browser's) reads as a host.
        return url.host !== PROBE_HOST || url.pathname.startsWith("//")
    } catch {
        return false
    }
}

/** The explicit-relative spelling of a bare relative href, else null. */
export const explicitRelativeHref = (href: string): string | null => {
    if (!href || isExternalHref(href)) return null
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return null
    const explicit = `./${href}`
    try {
        // A dot segment can climb to `//host`, which harden hands back as an OFF-SITE link.
        if (new URL(explicit, "http://x.invalid").pathname.startsWith("//")) return null
    } catch {
        return null
    }
    return explicit
}

/** Enough of a hast node to walk anchors without a `hast` dependency. */
interface HastNode {
    type: string
    tagName?: string
    properties?: Record<string, unknown> | null
    children?: HastNode[] | null
}

/** Respell bare relative anchor hrefs. MUST run immediately before `rehype-harden`. */
export const rehypeExplicitRelativeLinks = () => (tree: HastNode) => {
    const walk = (node: HastNode) => {
        if (node.type === "element" && node.tagName === "a" && node.properties) {
            const href = node.properties.href
            if (typeof href === "string") {
                const explicit = explicitRelativeHref(href)
                if (explicit) node.properties.href = explicit
            }
        }
        const children = node.children
        if (Array.isArray(children)) for (const child of children) if (child) walk(child)
    }
    walk(tree)
    return tree
}

/** Streamdown's own rehype list with the respelling inserted before its harden gate. */
export const withExplicitRelativeLinks = <T>(
    defaults: Record<string, T>,
): (T | typeof rehypeExplicitRelativeLinks)[] =>
    Object.entries(defaults).flatMap(([name, plugin]) =>
        name === "harden" ? [rehypeExplicitRelativeLinks, plugin] : [plugin],
    )

/** Undo the percent-encoding harden's `new URL()` round-trip adds; drive paths are raw. */
export const decodeDriveHref = (href: string): string => {
    try {
        return decodeURIComponent(href)
    } catch {
        return href
    }
}
