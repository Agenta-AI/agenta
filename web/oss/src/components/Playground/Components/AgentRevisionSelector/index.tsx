import {useCallback, useEffect, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {createWorkflowRevisionAdapter} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import {useCommitHostAdapter} from "../Modals/CommitVariantChangesModal/assets/useCommitHostAdapter"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {ssr: false})

/**
 * The agent playground's revision selector — the borderless "variant ⌄" picker plus a compact
 * `v{n} ● Draft/Saved` status. Lifted out of the config-panel header (PlaygroundVariantConfigHeader)
 * so the page header can host it next to the agent's name. Variant-scoped: it derives everything
 * from `variantId`, so it stays in sync wherever it's rendered.
 */
const AgentRevisionSelector = ({variantId}: {variantId: string}) => {
    // Project-scoped playground (no app in URL) browses all workflows; app-scoped stays scoped.
    const appId = useAtomValue(routerAppIdAtom)
    const isProjectScoped = !appId

    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isLocalDraftVariant = variantId ? isLocalDraftId(variantId) : false

    const _variantId = runnableData?.id ?? null

    // App browse picker (project-scoped only) — skip-variant, non-evaluator.
    const appOnlyAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
                parentLabel: "Application",
            }),
        [],
    )

    // An auto-commit is still a commit, so it owes this app the same out-of-band work a manual
    // one did: the registry and evaluator tables live outside the entities layer and go stale
    // otherwise. The agent header no longer carries the adapter (it has no Commit button to hang
    // it on), so the reaction hangs off the engine instead.
    const {onAfterCommit, onCommitted} = useCommitHostAdapter()
    useEffect(
        () =>
            registerAgentAutoCommitHandler("agent-revision-selector", () => {
                onAfterCommit()
                onCommitted()
            }),
        [onAfterCommit, onCommitted],
    )

    const switchEntity = useSetAtom(playgroundController.actions.switchEntity)
    const handleSwitchVariant = useCallback(
        (newVariantId: string) => {
            switchEntity({currentEntityId: variantId || "", newEntityId: newVariantId})
        },
        [switchEntity, variantId],
    )

    if (!variantId || isLocalDraftVariant) return null

    return (
        <div className="flex min-w-0 items-center gap-2">
            <SelectVariant
                mode={isProjectScoped ? "browse" : "scoped"}
                customBrowseAdapter={isProjectScoped ? appOnlyAdapter : undefined}
                showCreateNew
                onChange={(value) => handleSwitchVariant(value)}
                value={_variantId ?? undefined}
                borderlessTrigger
            />
            <AgentRevisionStatus revisionId={variantId} />
        </div>
    )
}

export default AgentRevisionSelector
