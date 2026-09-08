/**
 * The link gate in front of chat markdown — the piece that decides whether a markdown link
 * survives as an anchor at all, BEFORE any host renderer sees it.
 *
 * Streamdown's default rehype pipeline ends in `rehype-harden`, which drops any href it cannot
 * parse and leaves an inert `<span>… [blocked]</span>` in its place. It parses a relative href
 * only when the href starts with `/`, `./` or `../`; a bare `agent-files/report.md` throws in
 * `new URL()` and never reaches the host's anchor component. That bare form is exactly the form
 * the platform prompt tells the agent to write, so every file link the agent produced rendered as
 * dead grey text (#6659).
 *
 * {@link rehypeExplicitRelativeLinks} runs directly BEFORE harden and rewrites such an href to its
 * explicit-relative spelling (`./agent-files/report.md`). Harden then parses it, keeps the anchor,
 * and hands the host `/agent-files/report.md` — the leading-slash shape the drive resolver already
 * handles (#5983). Nothing is unblocked that harden would have blocked on SECURITY grounds: a
 * scheme URL, a protocol-relative `//host`, and a fragment keep their own paths through the gate,
 * and a local path is still resolved against the session's own mounts (or rendered inert) by the
 * host, never navigated to.
 */

/** A link target that must stay a plain external link: any `scheme:` URL (http, https, mailto,
 * tel, data, …), a protocol-relative `//host`, or an in-page `#fragment`. Everything else is a
 * RELATIVE or absolute PATH, which might name a file in this conversation's drive. */
export const isExternalHref = (href?: string): boolean =>
    !href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

/** The explicit-relative spelling of a bare relative href, or null when the href already parses
 * (absolute, explicitly relative, external). Exported for the unit tests and for any host that
 * needs the rule without the plugin. */
export const explicitRelativeHref = (href: string): string | null => {
    if (!href || isExternalHref(href)) return null
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return null
    return `./${href}`
}

/** Minimal structural view of a hast node — enough to walk anchors without a `hast` dependency. */
interface HastNode {
    type: string
    tagName?: string
    properties?: Record<string, unknown> | null
    children?: HastNode[] | null
}

/** Rewrite every bare relative anchor href to its explicit-relative spelling. Place it LAST before
 * `rehype-harden` in the rehype list, so harden still gates the result. */
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

/** Harden rebuilds a relative href through `new URL()`, which percent-encodes the path
 * (`./my report.md` → `/my%20report.md`). Drive paths are raw, so decode before resolving one. */
export const decodeDriveHref = (href: string): string => {
    try {
        return decodeURIComponent(href)
    } catch {
        return href
    }
}
