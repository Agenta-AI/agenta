/**
 * Agent requirements query, keyed by the saved revision id the page already holds.
 *
 * It depends on no other query, so it starts with the page's other requests and never holds the
 * first render. A save pins a new revision id, which is a new key, so the check runs again.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {isValidUUID} from "@agenta/shared/utils"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryAgentRequirements} from "../api/requirements"
import type {AgentRequirementItem, AgentRequirementsResult} from "../requirements"

const REQUIREMENTS_KEY = ["workflows", "requirements"] as const

/** Only a saved revision can be checked; a local draft id stays idle. */
const checkableRevision = (revisionId: string | null | undefined): revisionId is string =>
    Boolean(revisionId) && isValidUUID(revisionId as string)

export const agentRequirementsQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<AgentRequirementsResult | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: [...REQUIREMENTS_KEY, projectId, revisionId],
            // An unreadable answer is an error, so a refetch keeps the last good one.
            queryFn: async () => {
                const result = await queryAgentRequirements({
                    projectId: projectId as string,
                    revisionId,
                })
                if (!result) throw new Error("[agentRequirements] unreadable answer")
                return result
            },
            enabled: !!projectId && checkableRevision(revisionId),
            staleTime: 30_000,
            refetchOnWindowFocus: true,
        }
    }),
)

const EMPTY: AgentRequirementItem[] = []

/**
 * The requirements of one revision, or `null` until the server answered. `null` means "not
 * checked", which is different from an empty list ("ready"). A failed refetch keeps the last
 * answer, so a passing network error does not clear the tags or turn Send back on.
 */
export const agentRequirementsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): AgentRequirementItem[] | null => {
        if (!checkableRevision(revisionId)) return null
        const query = get(agentRequirementsQueryAtomFamily(revisionId))
        if (!query.data) return null
        return query.data.requirements ?? EMPTY
    }),
)

/** Ask every requirements query again, after a fix that keeps the revision (a sign-in, a new key). */
export const invalidateAgentRequirements = (): Promise<void> =>
    getHostQueryClient().invalidateQueries({queryKey: [...REQUIREMENTS_KEY]})
