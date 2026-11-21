import {createT} from "@agenta/i18n"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"

const LIMIT_REFUSAL_CODES = [
    "project_limit_reached",
    "instance_organization_limit_reached",
] as const

export type LimitRefusalCode = (typeof LIMIT_REFUSAL_CODES)[number]

/** The API's refusal of a new project or organization at the plan's limit. */
export interface LimitRefusal {
    code: LimitRefusalCode
    limit: number
}

/** What the reader can do next: upgrade the cloud plan, add a key, or ask the instance admin. */
export type LimitNextStep = "billing" | "license" | "askAdmin"

/** The limit refusal in an API error (`detail.code`), or null for any other error. */
export const readLimitRefusal = (error: unknown): LimitRefusal | null => {
    const detail = (error as {response?: {data?: {detail?: unknown}}} | null)?.response?.data
        ?.detail as {code?: unknown; limit?: unknown} | undefined
    if (
        !detail ||
        typeof detail !== "object" ||
        !LIMIT_REFUSAL_CODES.includes(detail.code as LimitRefusalCode)
    ) {
        return null
    }
    return {
        code: detail.code as LimitRefusalCode,
        limit: typeof detail.limit === "number" ? detail.limit : 1,
    }
}

export const limitNextStep = ({
    refusal,
    cloud,
    isInstanceAdmin,
}: {
    refusal: LimitRefusal
    cloud: boolean
    isInstanceAdmin: boolean
}): LimitNextStep => {
    if (cloud && refusal.code === "project_limit_reached") return "billing"
    return isInstanceAdmin ? "license" : "askAdmin"
}

const tNow = createT(limitRefusalCatalog)

/** The refusal as translated sentences. */
export const limitRefusalText = (refusal: LimitRefusal, {cloud}: {cloud: boolean}): string => {
    if (refusal.code === "instance_organization_limit_reached") {
        return tNow("shell.limitRefusal.organizationLimit", {limit: refusal.limit})
    }
    if (cloud) return tNow("shell.limitRefusal.projectLimitCloud")
    return `${tNow("shell.limitRefusal.projectLimit", {limit: refusal.limit})} ${tNow(
        "shell.limitRefusal.projectLimitFreeKey",
    )}`
}
