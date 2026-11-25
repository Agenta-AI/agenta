/**
 * The person's own accounts on the Settings pages: who may own a new account, when "Personal"
 * shows, and the "Used by" line of a person's secret. Pure, so the pages and the tests share it.
 */

import type {PersonalAccountsAccess} from "@agenta/entities/secret"
import {createT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import type {OwnerKind} from "@agenta/shared/types"

const t = createT(settingsSharedCatalog)

/** Whose account a Settings page adds: the person's own, or the current project's. */
type AccountOwner = Exclude<OwnerKind, "organization">

/** Owners narrow to wide; the narrowest allowed one is the add form's default. */
const OWNER_ORDER: readonly OwnerKind[] = ["user", "project", "organization"]

/** The owners each connections page can hold. MCP servers are always the project's. */
export const PAGE_OWNERS = {
    integrations: ["user", "project"],
    secrets: ["user", "project"],
    providers: ["project", "organization"],
    mcps: ["project"],
} as const satisfies Record<string, readonly OwnerKind[]>

/** The Owner filter's value: every owner, or one. */
export type OwnerFilter = "all" | OwnerKind

/**
 * The allowed owners with the add form's default first: the filtered owner when the filter names
 * an allowed one, else the narrowest. The form shows them narrow to wide whatever the order.
 */
export const ownersWithDefault = <Owner extends OwnerKind>(
    allowed: readonly Owner[],
    filter: OwnerFilter = "all",
): Owner[] => {
    const sorted = OWNER_ORDER.filter((owner): owner is Owner => allowed.includes(owner as Owner))
    const first = sorted.find((owner) => owner === filter) ?? sorted[0]
    return first ? [first, ...sorted.filter((owner) => owner !== first)] : []
}

/** Whether a group of this owner shows under the Owner filter. */
export const ownerShown = (filter: OwnerFilter, owner: OwnerKind): boolean =>
    filter === "all" || filter === owner

/** "Personal" shows only when the switch is known to be on. */
export const showsYours = (access: PersonalAccountsAccess): boolean => access === "on"

/**
 * Who may own an account added on a Settings page; the first is the default.
 *
 * - Switch on, with the page's edit permission: both, so the dialog asks for the Owner.
 * - Switch on, without it: the person's own only, with no question.
 * - Switch off (or not known yet): `undefined`, which is today's behaviour, the project's.
 */
export const addAccountOwners = (
    access: PersonalAccountsAccess,
    canEdit: boolean,
): AccountOwner[] | undefined => {
    if (!showsYours(access)) return undefined
    return canEdit ? ["user", "project"] : ["user"]
}

/** The cache key of one "Used by" read: the person's secret ids, sorted, comma joined. */
export const secretIdsKey = (ids: (string | null | undefined)[]): string =>
    [...new Set(ids.filter((id): id is string => Boolean(id)))].sort().join(",")

/** The agents whose choices name each secret, in first-seen order, each agent once. */
export const agentsBySecret = (
    choices: {secret_id?: string | null; workflow_id: string}[],
): Map<string, string[]> => {
    const bySecret = new Map<string, string[]>()
    for (const choice of choices) {
        if (!choice.secret_id) continue
        const agents = bySecret.get(choice.secret_id) ?? []
        if (!agents.includes(choice.workflow_id)) agents.push(choice.workflow_id)
        bySecret.set(choice.secret_id, agents)
    }
    return bySecret
}

/**
 * The line under a person's secret. `null` while a name is still loading, so the line does not
 * change its words under the reader.
 */
export const usedByLine = (names: (string | null | undefined)[]): string | null => {
    if (names.length === 0) return t("settings.shared.notUsedByAnyAgent")
    if (names.some((name) => !name)) return null
    return t("settings.shared.usedBy", {names: [...new Set(names as string[])].join(", ")})
}

/** The empty "Personal" note: where a person's own account is used. */
export const yoursEmptyBody = (projectCount?: number): string =>
    projectCount && projectCount > 1
        ? t("settings.shared.yoursEmptyBodyCount", {projectCount})
        : t("settings.shared.yoursEmptyBody")
