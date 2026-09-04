/**
 * Human names for the scalar config keys a diff reports.
 *
 * The diff used to print the storage path and the stored value verbatim —
 * `runner.permissions.default  allow → allow_reads`. That is the JSON, not the setting: a reader
 * who has not seen the schema cannot tell what changed or whether it matters.
 *
 * Keys are matched by exact path, because the same leaf means different things under different
 * parents (`harness.permissions.default_mode` is not `runner.permissions.default`). Anything
 * unmapped falls back to a humanized path rather than being hidden — a new template key should
 * read imperfectly, never disappear.
 *
 * Wording follows the config panel's own controls wherever it has one, so the same setting is not
 * called two things in two places.
 */
import {permissionPolicyLabel} from "@agenta/shared/utils"

const PATH_LABELS: Record<string, string> = {
    // Generation parameters (PARAM_KEYS).
    temperature: "Temperature",
    max_tokens: "Max tokens",
    top_p: "Top P",
    frequency_penalty: "Frequency penalty",
    presence_penalty: "Presence penalty",
    tool_choice: "Tool choice",
    response_format: "Response format",
    stream: "Streaming",
    template_format: "Template format",
    fallback_policy: "Fallback policy",
    retry_policy: "Retry policy",

    // Model & harness. These reach the same renderer, so they had the same problem.
    "llm.model": "Model",
    "llm.provider": "Provider",
    "llm.connection.mode": "Connection mode",
    "harness.kind": "Harness",
    "harness.max_iterations": "Max iterations",
    "harness.permissions.web_search": "Web search",

    // Execution sections. The panel labels the runner policy "Policy" inside its Permissions
    // group; standalone in a diff row that says too little, so it names the subject too.
    "runner.permissions.default": "Tool permissions",
    "harness.permissions.default_mode": "Harness permissions",
    // The Claude permissions control's own field labels.
    "harness.permissions.allow": "Allow rules",
    "harness.permissions.ask": "Ask rules",
    "harness.permissions.deny": "Deny rules",
    "sandbox.kind": "Sandbox",
    "sandbox.permissions": "Sandbox permissions",
}

/** An integration's permission vocabulary, as the tool form spells it. */
const GATEWAY_PERMISSION_LABELS: Record<string, string> = {
    allow: "Allow",
    ask: "Ask",
    deny: "Deny",
    inherit: "Inherit",
}

/** What to call a gateway permission. Unset means the entry inherits the integration default. */
export const gatewayPermissionLabel = (value: string | undefined): string =>
    (value && GATEWAY_PERMISSION_LABELS[value]) ?? "Inherit"

/** Per-path value vocabulary — the stored enum is not what the control calls it. */
const VALUE_LABELS: Record<string, (value: string) => string | undefined> = {
    "runner.permissions.default": permissionPolicyLabel,
}

/** Segments a humanized path should not lowercase. */
const ACRONYMS: Record<string, string> = {llm: "LLM", api: "API", url: "URL", id: "ID"}

const humanizeSegment = (segment: string): string =>
    ACRONYMS[segment.toLowerCase()] ?? segment.replace(/[_-]+/g, " ").trim().toLowerCase()

/**
 * `sandbox.permissions.network` → "Sandbox › network". Keeps the parent, because a bare leaf
 * ("network", "default") is ambiguous across sections.
 */
const humanizePath = (path: string): string => {
    const segments = path.split(".").filter(Boolean)
    if (segments.length === 0) return path
    const head = humanizeSegment(segments[0])
    const label =
        segments.length === 1
            ? head
            : `${head} › ${segments.slice(1).map(humanizeSegment).join(" › ")}`
    return label.charAt(0).toUpperCase() + label.slice(1)
}

/** What to call this config key in a diff row. */
export const scalarKeyLabel = (path: string): string => PATH_LABELS[path] ?? humanizePath(path)

/**
 * What to call this value. Known enums resolve to the control's own wording; booleans read as
 * On/Off; everything else is shown as stored, since inventing a name for an arbitrary value
 * would be a guess.
 */
export const scalarValueLabel = (
    path: string,
    value: string | undefined,
    raw?: unknown,
): string | undefined => {
    if (value === undefined) return undefined
    const mapped = VALUE_LABELS[path]?.(value)
    if (mapped) return mapped
    // Only a real boolean reads as On/Off; the string "false" is a value, not a flag.
    if (typeof raw === "boolean") return raw ? "On" : "Off"
    // A rule list is prose, not JSON: `["Bash"]` is punctuation a reader has to decode.
    if (Array.isArray(raw)) return raw.length ? raw.map(String).join(", ") : "None"
    return value
}
