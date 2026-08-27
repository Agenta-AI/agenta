import {useCallback} from "react"

import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import {
    clearEvaluatorWorkflowCache,
    evaluatorsPaginatedStore,
} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {
    clearRegistryVariantNameCache,
    registryPaginatedStore,
} from "@/oss/components/VariantsComponents/store/registryStore"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {selectedAppIdAtom} from "@/oss/state/app"

/**
 * What THIS app has to add to a commit: its own out-of-band caches (the variant registry and the
 * evaluator tables, neither of which lives in the entities layer) and the onboarding event.
 *
 * A hook rather than only a button wrapper, because the agent playground renders the shared
 * `AgentConfigHeader` instead of the button directly — and a header that skipped this left the
 * registry and evaluator lists stale after every agent commit.
 */
export const useCommitHostAdapter = () => {
    const appId = useAtomValue(selectedAppIdAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const onAfterCommit = useCallback(() => {
        clearRegistryVariantNameCache()
        clearEvaluatorWorkflowCache()
        getDefaultStore().set(registryPaginatedStore.actions.refresh)
        getDefaultStore().set(evaluatorsPaginatedStore.actions.refresh)
    }, [])

    const onCommitted = useCallback(
        () => recordWidgetEvent("playground_committed_change"),
        [recordWidgetEvent],
    )

    return {appId, onAfterCommit, onCommitted}
}
