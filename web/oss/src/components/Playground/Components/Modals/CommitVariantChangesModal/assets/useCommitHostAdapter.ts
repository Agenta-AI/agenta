import {useCallback, useMemo} from "react"

import type {CommitHostAdapter} from "@agenta/playground-ui/commit"
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
 * What THIS app has to do after a commit that the commit itself has no business knowing: refresh
 * its own out-of-band caches (the variant registry and evaluator tables, neither of which lives in
 * the entities layer) and record the onboarding event.
 *
 * A hook rather than a wrapper component, because two surfaces need it: the app's
 * `CommitVariantChangesButton` adapter, and `AgentConfigHeader`, which renders the package's commit
 * button ITSELF and so can only be reached through props.
 */
export const useCommitHostAdapter = (): Required<CommitHostAdapter> => {
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

    return useMemo(() => ({appId, onAfterCommit, onCommitted}), [appId, onAfterCommit, onCommitted])
}
