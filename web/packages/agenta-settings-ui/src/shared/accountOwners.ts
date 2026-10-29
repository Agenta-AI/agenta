/**
 * The person's own accounts on the Settings pages: who may own a new account, when "Yours"
 * shows, and the "Used by" line of a person's secret. Pure, so the pages and the tests share it.
 */

/** Whose account: the person's own, or the current project's. */
export type AccountOwner = "user" | "project"

/** The deployment switch as `personalAccountsAccessAtom` reads it. */
export type PersonalAccess = "loading" | "on" | "off" | "error"

/** "Yours" shows only when the switch is known to be on. */
export const showsYours = (access: PersonalAccess): boolean => access === "on"

/**
 * Who may own an account added on a Settings page; the first is the default.
 *
 * - Switch on, with the page's edit permission: both, so the dialog asks "Who can use it".
 * - Switch on, without it: the person's own only, with no question.
 * - Switch off (or not known yet): `undefined`, which is today's behaviour, the project's.
 */
export const addAccountOwners = (
    access: PersonalAccess,
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
    if (names.length === 0) return "Not used by any agent"
    if (names.some((name) => !name)) return null
    return `Used by ${[...new Set(names as string[])].join(", ")}`
}

/** The empty "Yours" note: where a person's own account is used. */
export const yoursEmptyBody = (projectCount?: number): string =>
    projectCount && projectCount > 1
        ? `Accounts you add here are used in all ${projectCount} of your projects, when an agent uses each person's own account.`
        : "Accounts you add here are used in all your projects, when an agent uses each person's own account."
