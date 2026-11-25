/**
 * The asker's approval choices in the project. A write calls `invalidateApprovalChoices`.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryApprovalChoices} from "./api"
import type {ApprovalChoice} from "./schema"

const APPROVAL_CHOICES_KEY = ["approval-choices"] as const

/** The answer names the asker's own choices, so it is cached per person. */
export const approvalChoicesQueryAtom = atomWithQuery<ApprovalChoice[]>((get) => {
    const projectId = get(projectIdAtom)
    const userId = get(userAtom)?.id ?? null
    return {
        queryKey: [...APPROVAL_CHOICES_KEY, userId, projectId],
        queryFn: () => queryApprovalChoices({projectId: projectId as string}),
        enabled: !!projectId && !!userId,
        staleTime: 30_000,
    }
})

export const invalidateApprovalChoices = (): Promise<void> =>
    getHostQueryClient().invalidateQueries({queryKey: [...APPROVAL_CHOICES_KEY]})
