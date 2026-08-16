import {useCallback} from "react"

import {CommitVariantChangesButton as CommitVariantChangesButtonView} from "@agenta/playground-ui/commit"
import type {CommitVariantChangesButtonProps} from "@agenta/playground-ui/commit"
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
 * App adapter over the shared commit button: the commit itself is the package's, and what this
 * app adds are its own out-of-band caches (the variant registry and evaluator tables, which do
 * not live in the entities layer) plus the onboarding event.
 */
const CommitVariantChangesButton = (
    props: Omit<CommitVariantChangesButtonProps, "appId" | "onAfterCommit" | "onCommitted">,
) => {
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

    return (
        <CommitVariantChangesButtonView
            {...props}
            appId={appId}
            onAfterCommit={onAfterCommit}
            onCommitted={onCommitted}
        />
    )
}

export default CommitVariantChangesButton
