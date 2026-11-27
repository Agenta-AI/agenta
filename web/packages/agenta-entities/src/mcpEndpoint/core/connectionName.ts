/**
 * What a new MCP connection is called before anyone types anything.
 *
 * A server name does not identify an account, and the same server can hold several, so the
 * suggestion has to be distinguishable rather than merely plausible. Display names are
 * unique per project, so a suggestion that collides is disambiguated here rather than
 * bounced back at the person as a validation error on a field they never filled in.
 *
 * `serverInfo.name` is preferred when the probe got one, and the address is the fallback:
 * an authenticated server may refuse to say anything about itself before consent, which is
 * exactly when the person is being asked for a name. The address gives the service's own
 * name, made readable ("Linear" for `https://mcp.linear.app/sse`).
 */

import {skillDisplayName} from "@agenta/shared/utils"

import {PROVIDERS} from "../../workflow/agentTemplates"

/** The ordinals the integrations flow uses, so both surfaces read the same. */
const ORDINALS = ["main", "secondary"]

/** The readable part of a URL: its host, with a leading `www.` dropped. */
export function hostnameLabel(url: string): string {
    try {
        const {hostname} = new URL(url)
        return hostname.replace(/^www\./, "")
    } catch {
        return ""
    }
}

/**
 * The form the API deduplicates on: every character outside `[A-Za-z0-9_]` becomes an
 * underscore. Two labels that normalize alike are one name to the platform, so "Acme Tools"
 * and "Acme-Tools" collide even though they read differently.
 *
 * This mirrors the server rule rather than inventing a friendlier one. A client check that
 * is laxer lets a person submit a name the API then refuses; one that is stricter refuses a
 * name the API would have taken.
 */
export const normalizeConnectionName = (name: string): string =>
    name.trim().replace(/[^A-Za-z0-9_]/g, "_")

const normalize = normalizeConnectionName

/** Host labels that name the endpoint, not the service: `mcp.linear.app` is Linear's. */
const ENDPOINT_LABELS = new Set(["www", "mcp", "api", "server"])
/** Second-level labels under a country code: `acme.co.uk` is Acme's, not "co". */
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "ac", "edu"])

/**
 * The service a URL points at: the first host label that does not name the endpoint, without
 * the top-level domain ("linear" for `https://mcp.linear.app/sse`, "my-tools" for
 * `https://my-tools.workers.dev`). A single-label host (a container name, `localhost`) and an
 * IP address stay as they are.
 */
export function serverAddressLabel(url: string): string {
    const host = hostnameLabel(url)
    if (!host || /^[\d.]+$/.test(host) || host.includes(":")) return host
    const labels = host.split(".").filter(Boolean)
    if (labels.length < 2) return host
    labels.pop()
    if (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels[labels.length - 1])) labels.pop()
    const named = labels.filter((label) => !ENDPOINT_LABELS.has(label))
    return named[0] ?? labels[labels.length - 1] ?? host
}

/** Known brands by their bare slug, longest first: "githubcopilot" reads as GitHub + copilot. */
const BRANDS = Object.entries(PROVIDERS)
    .map(([slug, {label}]) => [slug.replace(/_/g, ""), label] as const)
    .sort((a, b) => b[0].length - a[0].length)

const readableWord = (word: string): string => {
    const lower = word.toLowerCase()
    for (const [slug, label] of BRANDS) {
        if (lower === slug) return label
        if (lower.startsWith(slug) && lower.length - slug.length >= 3)
            return `${label} ${readableWord(lower.slice(slug.length))}`
    }
    return skillDisplayName(word)
}

/** The address label as words: "githubcopilot" → "GitHub Copilot"; an IP stays as it is. */
export function readableServerLabel(label: string): string {
    if (!label || /^[\d.]+$/.test(label) || label.includes(":")) return label
    return label.split(/[-_]+/).filter(Boolean).map(readableWord).join(" ") || label
}

/**
 * A display name for a new connection that no existing connection already uses.
 *
 * The first connection to a server is offered the bare name; a second is offered
 * "(secondary)" and later ones a number, matching `defaultConnectionName` in
 * `@agenta/shared/utils`. That utility counts per integration key, which custom MCP rows do
 * not have, so this counts per name collision instead — and it compares the way the API
 * does, so a suggestion is never one the API would reject.
 */
export function suggestConnectionName({
    serverName,
    url,
    existingNames = [],
}: {
    serverName?: string | null
    url: string
    existingNames?: (string | null | undefined)[]
}): string {
    const base =
        (serverName || "").trim() || readableServerLabel(serverAddressLabel(url)) || "MCP server"
    const taken = new Set(existingNames.filter((name): name is string => !!name).map(normalize))

    if (!taken.has(normalize(base))) return base

    for (let index = 1; index < 100; index++) {
        const ordinal = ORDINALS[index] ?? String(index + 1)
        const candidate = `${base} (${ordinal})`
        if (!taken.has(normalize(candidate))) return candidate
    }
    return base
}

/**
 * What the API answers a taken display name with, as a reader meets it: the `message` and
 * the `next_step` of its 409 `mcp_connection_name_taken`, joined the way
 * `gatewayRefusalMessage` joins them.
 *
 * Repeated here rather than asked for, because the client refuses a collision it can
 * already see without making the request. Two wordings for one refusal is how a person
 * learns that the sheet and the server disagree about what a duplicate is, so both paths
 * say this (decision 15). `mcpConnectionName.test.ts` pins it against the API's own
 * strings in `api/oss/src/core/gateways/mcps/types.py` and `.../gateways/exceptions.py`.
 */
export const NAME_TAKEN_REFUSAL =
    "Another connection in this project already uses this name; pick a different one. " +
    "Give this connection a name no other one in the project uses."

/**
 * Why this display name cannot be used, or null when it can.
 *
 * Compared on the normalized form the API deduplicates on, so this refuses exactly what a
 * save would refuse, in the words the save would refuse it with.
 */
export function connectionNameProblem({
    name,
    existingNames = [],
    currentName,
}: {
    name: string
    existingNames?: (string | null | undefined)[]
    /** The name this connection already has, which is never a collision with itself. */
    currentName?: string | null
}): string | null {
    const trimmed = name.trim()
    if (!trimmed) return "Enter a name."

    const mine = currentName ? normalize(currentName) : null
    const taken = existingNames
        .filter((existing): existing is string => !!existing)
        .map(normalize)
        .filter((existing) => existing !== mine)

    if (taken.includes(normalize(trimmed))) {
        return NAME_TAKEN_REFUSAL
    }
    return null
}
