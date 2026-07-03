import {useCallback, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {createWorkflowRevisionAdapter} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

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
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))
    const isLocalDraftVariant = variantId ? isLocalDraftId(variantId) : false

    const _variantId = runnableData?.id ?? null
    const variantRevision = (runnableData?.version as number | null) ?? null
    const hasChanges = isDirty

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
            {variantRevision !== null && variantRevision !== undefined && (
                <span className="rounded bg-[var(--ant-color-fill-secondary)] px-1.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]">
                    v{variantRevision}
                </span>
            )}
            <Tooltip title={hasChanges ? "Draft — unsaved changes" : "Saved"}>
                <span className="flex items-center gap-1.5 text-xs text-[var(--ant-color-text-tertiary)]">
                    <span
                        className="h-[7px] w-[7px] rounded-full"
                        style={{
                            backgroundColor: hasChanges
                                ? "var(--ant-color-warning)"
                                : "var(--ant-color-success)",
                        }}
                    />
                    {hasChanges ? "Draft" : "Saved"}
                </span>
            </Tooltip>
        </div>
    )
}

export default AgentRevisionSelector
