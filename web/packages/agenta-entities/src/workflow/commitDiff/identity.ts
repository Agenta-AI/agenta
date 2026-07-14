/**
 * Canonical, collision-free identity for an agent-template list item (tool / mcp / skill).
 *
 * Used to match a LIVE item against its COMMITTED counterpart when deciding new/edited/removed —
 * both by the commit-diff classifier and by the config panel's per-row draft indicators. A stable
 * id is preferred (reference slug, function name, platform op, name, embed slug); when an item
 * carries none (e.g. a bare builtin tool `{type:"web_search"}`), it falls back to a POSITIONAL key
 * so two id-less items never collapse onto the same map key (which would silently drop one).
 *
 * Pure and dependency-free so it can be shared across the classifier (`@agenta/entities`) and the
 * config panel (`@agenta/entity-ui`) without pulling in either package's helpers.
 */
export type AgentItemKind = "tool" | "mcp" | "skill"

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** The workflow slug an `@ag.embed` reference points at (skills, embedded workflow tools). */
function embedSlug(rec: Record<string, unknown>): string | undefined {
    const embed = isObj(rec["@ag.embed"]) ? rec["@ag.embed"] : undefined
    const refs = embed && isObj(embed["@ag.references"]) ? embed["@ag.references"] : undefined
    if (!refs) return undefined
    const wf = isObj(refs.workflow)
        ? refs.workflow
        : isObj(refs.workflow_revision)
          ? refs.workflow_revision
          : undefined
    return wf && typeof wf.slug === "string" ? wf.slug : undefined
}

export function agentItemIdentity(kind: AgentItemKind, item: unknown, index: number): string {
    const rec = isObj(item) ? item : {}
    if (kind === "tool") {
        // Workflow-reference tool — keyed by the slug it targets.
        if (rec.type === "reference" && typeof rec.slug === "string" && rec.slug)
            return `ref:${rec.slug}`
        // Function / gateway tool — keyed by its function name (wrapped `function.name` or the
        // flat legacy shape `{name, description, parameters}`).
        const fn = isObj(rec.function) ? rec.function : undefined
        if (fn && typeof fn.name === "string" && fn.name) return `fn:${fn.name}`
        if (
            (rec.type === undefined || rec.type === "function") &&
            typeof rec.name === "string" &&
            rec.name
        )
            return `fn:${rec.name}`
        // Platform op tool.
        if (rec.type === "platform" && typeof rec.op === "string" && rec.op)
            return `platform:${rec.op}`
        // Bare builtin (only a `type`) or anything else — positional, so duplicates never collapse.
        return `#${index}`
    }
    if (kind === "skill") {
        const slug = embedSlug(rec)
        if (slug) return `skill:${slug}`
        if (typeof rec.name === "string" && rec.name) return `skill:${rec.name}`
        return `#${index}`
    }
    // mcp
    if (typeof rec.name === "string" && rec.name) return `mcp:${rec.name}`
    return `#${index}`
}
