/**
 * Module-level constants for PlaygroundConfigSection: fallback/retry policy
 * option lists, the prompt-extension key set, and the virtual "sibling group"
 * map that surfaces `data.*` fields alongside `parameters`.
 */

export const FALLBACK_POLICY_OPTIONS = [
    "off",
    "availability",
    "capacity",
    "access",
    "context",
    "any",
].map((value) => ({label: value, value}))
export const RETRY_POLICY_OPTIONS = ["off", "availability", "capacity", "transient", "any"].map(
    (value) => ({label: value, value}),
)
export const DEFAULT_RETRY_CONFIG = {
    max_retries: null as number | null,
    base_delay: null as number | null,
}
export const PROMPT_EXTENSION_KEYS = [
    "fallback_configs",
    "fallback_policy",
    "retry_config",
    "retry_policy",
]

// Virtual section keys for sibling data fields; `["hook","url"]` maps to `data.url`.
export const SIBLING_GROUPS = {
    hook: ["url", "headers"],
    code: ["script", "runtime"],
    schemas: ["parameters", "inputs", "outputs"],
} as const
export type SiblingGroupKey = keyof typeof SIBLING_GROUPS
export const SIBLING_GROUP_KEYS = Object.keys(SIBLING_GROUPS) as SiblingGroupKey[]
