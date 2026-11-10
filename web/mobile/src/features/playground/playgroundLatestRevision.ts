import {queryWorkflowRevisionsByWorkflow} from "@agenta/entities/workflow"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {isEmptySeed} from "../variants/useAppRevisions"

const PAGE_SIZE = 20

/** The key of the playground's latest-revision query. `retry` refetches it by this shape. */
export const playgroundLatestRevisionKey = (appId: string, projectId: string | null) =>
    ["workflows", "playgroundLatest", appId, projectId] as const

/**
 * The revision the playground opens when the URL names none: the app's newest revision that is
 * not a new variant's empty seed. It uses the variants page's rule (`isEmptySeed`), so a
 * version 0 that holds a config opens, and an empty one is skipped.
 *
 * The shared latest-revision query skips every version 0, so an app whose only revision left is a
 * real version 0 has no latest revision there. That query also serves /w, so the playground asks
 * here instead.
 */
export const playgroundLatestRevisionIdAtomFamily = atomFamily((appId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: playgroundLatestRevisionKey(appId, projectId),
            queryFn: async (): Promise<string | null> => {
                if (!projectId) return null
                let next: string | null = null
                do {
                    const page = await queryWorkflowRevisionsByWorkflow(
                        appId,
                        projectId,
                        undefined,
                        {next, limit: PAGE_SIZE, order: "descending"},
                    )
                    const found = page.workflow_revisions.find((item) => !isEmptySeed(item))
                    if (found) return found.id
                    next = page.windowing?.next ?? null
                } while (next)
                return null
            },
            enabled: get(sessionAtom) && !!projectId && !!appId,
        }
    }),
)
