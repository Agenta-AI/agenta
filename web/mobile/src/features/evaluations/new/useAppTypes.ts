import {useMemo} from "react"

import {workflowAppTypeAtomFamily, type WorkflowType} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

/**
 * The type of each app (chat, completion, custom), read from its latest revision as the prompts
 * list reads it. An app whose revision has not loaded yet maps to null.
 */
export const useAppTypes = (
    appIds: readonly string[],
): ReadonlyMap<string, WorkflowType | null> => {
    const key = appIds.join(",")
    const typesAtom = useMemo(
        () =>
            atom(
                (get) =>
                    new Map(
                        (key ? key.split(",") : []).map(
                            (id) => [id, get(workflowAppTypeAtomFamily(id))] as const,
                        ),
                    ),
            ),
        [key],
    )
    return useAtomValue(typesAtom)
}
