export const IGNORED_LOCATION_PARTS = ["body", "agenta_config", "prompt"] as const
export type IgnoredLocationPart = (typeof IGNORED_LOCATION_PARTS)[number]

export const VALIDATION_TYPE_CTX_MAP = {
    greater_than_equal: "ge",
    less_than_equal: "le",
    greater_than: "gt",
    less_than: "lt",
} as const
