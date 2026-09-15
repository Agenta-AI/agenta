/**
 * How a saved agent configuration points at an MCP connection.
 *
 * The item carries two different things that are easy to confuse.
 *
 * `connection.slug` is identity. It is the endpoint row's own slug, handed back by the API
 * when the connection was created, and it is what the gateway resolves at run time. It is
 * never derived from anything the person typed.
 *
 * `name` is the model-facing tool prefix. It is frozen from the display name at save, in the
 * charset a tool name allows, and it stays put afterwards — so renaming a connection in
 * settings changes what people read without renaming the tools an already-saved agent calls.
 * That is deliberate: a rename that silently renamed tools would change what the model sees
 * mid-conversation.
 *
 * The older shape was `{type: "http", url}` with `name` doubling as the slug. It is still
 * read, because configurations saved under it are still out there, and no longer written.
 */

/** Tool names allow these; everything else becomes a hyphen. */
const UNSAFE = /[^A-Za-z0-9._-]+/g
const LEADING = /^[-._]+/

/** Reserved for the platform's own tools, so a connection may not claim it. */
export const RESERVED_TOOL_PREFIX = "agenta-tools"

export const MAX_TOOL_PREFIX_LENGTH = 128

export interface McpGatewayConnectionRef {
    type: "gateway"
    namespace: "custom"
    slug: string
}

/**
 * The tool prefix a display name freezes into, or null when it cannot make a usable one.
 *
 * Null is a real answer: a name of only punctuation, or the reserved prefix, has no valid
 * form, and inventing one would hand the agent a tool namespace nobody chose.
 */
export function toolPrefixFromName(displayName: string): string | null {
    const prefix = displayName
        .trim()
        .replace(UNSAFE, "-")
        .replace(LEADING, "")
        .slice(0, MAX_TOOL_PREFIX_LENGTH)

    if (!prefix) return null
    if (prefix === RESERVED_TOOL_PREFIX) return null
    return prefix
}

/** Build the reference an agent config stores for a connection. */
export function buildMcpConnectionRef(slug: string): McpGatewayConnectionRef {
    return {type: "gateway", namespace: "custom", slug}
}

type Item = Record<string, unknown> | null | undefined

/**
 * The connection slug an MCP config item points at, in either shape.
 *
 * Under the older shape the item had no slug of its own and `name` was it, so that is what
 * a legacy item resolves to.
 */
export function readMcpConnectionSlug(item: Item): string | undefined {
    const connection = (item?.connection ?? null) as Record<string, unknown> | null
    const slug = connection?.slug
    if (typeof slug === "string" && slug) return slug

    if (connection?.type === "http" || typeof connection?.url === "string") {
        const name = item?.name
        return typeof name === "string" && name ? name : undefined
    }
    return undefined
}

/** Whether this item still carries the shape that is only read, never written. */
export function isLegacyMcpItem(item: Item): boolean {
    const connection = (item?.connection ?? null) as Record<string, unknown> | null
    if (!connection) return false
    return connection.type === "http" || typeof connection.url === "string"
}
