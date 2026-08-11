import type {SessionListFilters} from "@agenta/entities/session"

export const mobileSessionListPolicy = {
    origins: undefined,
    excludeOrigins: undefined,
    expand: [],
} satisfies Pick<SessionListFilters, "origins" | "excludeOrigins" | "expand">
