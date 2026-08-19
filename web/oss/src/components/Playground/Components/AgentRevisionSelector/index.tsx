import {useCallback, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {createWorkflowRevisionAdapter} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {ssr: false})

/**
 * The agent playground's revision selector — the borderless "variant ⌄" picker plus a compact
 * `v{n} ● Draft/Saved` status. Lifted out of the config-panel header (PlaygroundVariantConfigHeader)
 * so the page header can host it next to the agent's name. Variant-scoped: it derives everything
 * from `variantId`, so it stays in sync wherever it's rendered. The Draft tag is also the revert
 * entry point — click it to discard the uncommitted changes.
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
    const commitMessage = runnableData?.message?.trim() || null
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

    // Revert action, re-homed here from the (now-removed, agent-only) kebab menu — same discard
    // handler, now reached via the Draft tag instead.
    const handleRevertChanges = useCallback(() => {
        if (!_variantId) return
        try {
            workflowMolecule.set.discard(_variantId)
            message.success("Draft changes discarded")
        } catch (e) {
            message.error("Failed to discard draft changes")
            console.error(e)
        }
    }, [_variantId])

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
                versioning="linear"
            />
            {variantRevision !== null && variantRevision !== undefined && (
                <Tooltip
                    styles={{root: {maxWidth: 360}}}
                    title={
                        commitMessage ? (
                            <div className="flex flex-col gap-1">
                                <span className="text-[12px] font-medium uppercase tracking-wide opacity-65">
                                    Commit message
                                </span>
                                <div className="max-h-[240px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-xs leading-relaxed">
                                    {commitMessage}
                                </div>
                            </div>
                        ) : (
                            <span className="text-xs italic">No commit message</span>
                        )
                    }
                >
                    <span className="cursor-default rounded bg-[var(--ant-color-fill-secondary)] px-1.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]">
                        v{variantRevision}
                    </span>
                </Tooltip>
            )}
            {hasChanges ? (
                // Draft tag doubles as the revert entry point — click to discard the uncommitted
                // changes (re-homed from the config header's kebab menu).
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Draft — unsaved changes"
                            className="flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ant-color-text-tertiary)] hover:bg-[var(--ant-color-fill-tertiary)]"
                        >
                            <span
                                className="h-[7px] w-[7px] rounded-full"
                                style={{backgroundColor: "var(--ant-color-warning)"}}
                            />
                            Draft
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="bottom" align="start">
                        <DropdownMenuItem variant="destructive" onSelect={handleRevertChanges}>
                            Revert changes
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <Tooltip title="Saved">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--ant-color-text-tertiary)]">
                        <span
                            className="h-[7px] w-[7px] rounded-full"
                            style={{backgroundColor: "var(--ant-color-success)"}}
                        />
                        Saved
                    </span>
                </Tooltip>
            )}
        </div>
    )
}

export default AgentRevisionSelector
