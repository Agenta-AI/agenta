/**
 * `rehype-harden`, the last plugin in Streamdown's rehype pipeline, drops any anchor whose href it
 * cannot parse: a relative target parses only when it starts with `/`, `./` or `../`, so the bare
 * form the platform prompt prescribes rendered as inert "[blocked]" text (#6659).
 */

/** True for a `scheme:` URL, a protocol-relative `//host` or a `#fragment`; false for a path. */
export const isExternalHref = (href?: string): boolean =>
    !href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)

/** The explicit-relative spelling of a bare relative href, else null. */
export const explicitRelativeHref = (href: string): string | null => {
    if (!href || isExternalHref(href)) return null
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return null
    return `./${href}`
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

/** Undo the percent-encoding harden's `new URL()` round-trip adds; drive paths are raw. */
export const decodeDriveHref = (href: string): string => {
    try {
        return decodeURIComponent(href)
    } catch {
        return href
    }
}
