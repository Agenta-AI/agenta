/**
 * DrawerHeader
 *
 * Row 1 of the unified drawer.
 *
 * Layout:
 *   [x] [title] [prev/next]                        [actions] [expand]
 *
 * - Title shows "Workflow Revision" or "Evaluator" based on context
 * - Action buttons depend on context:
 *   - variant/deployment: Playground, Deploy, Commit
 *   - evaluator-view: (no top-level actions — config header has Commit)
 *   - evaluator-create: (no actions or navigation — config header has Commit)
 * - Navigation arrows appear when navigationIds has > 1 entry (except evaluator-create)
 * - Info popover (metadata) shows in expanded mode only
 */
import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {ArrowsIn, ArrowsOut, CaretDown, CaretUp, Info, X} from "@phosphor-icons/react"
import {Button, Input, Popover, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useDrawerProviders} from "./DrawerContext"
import MetadataSidebar from "./MetadataSidebar"
import {
    closeWorkflowRevisionDrawerAtom,
    isCreateContext,
    navigateWorkflowRevisionDrawerAtom,
    workflowRevisionDrawerContextAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerNavigationIdsAtom,
} from "./store"

const {Text} = Typography

// ================================================================
// NAV CONTROLS
// ================================================================

const NavControls = memo(({entityId}: {entityId: string}) => {
    const navigationIds = useAtomValue(workflowRevisionDrawerNavigationIdsAtom)
    const navigate = useSetAtom(navigateWorkflowRevisionDrawerAtom)
    const {onNavigate} = useDrawerProviders()

    const currentIndex = useMemo(() => navigationIds.indexOf(entityId), [navigationIds, entityId])

    const handleNavigate = useCallback(
        (targetId: string) => {
            navigate(targetId)
            onNavigate?.(targetId)
        },
        [navigate, onNavigate],
    )

    if (navigationIds.length <= 1) return null

    const isPrevDisabled = currentIndex <= 0
    const isNextDisabled = currentIndex >= navigationIds.length - 1

    return (
        <div className="flex items-center gap-0.5">
            <Button
                icon={<CaretUp size={14} />}
                size="small"
                type="text"
                disabled={isPrevDisabled}
                onClick={() => {
                    if (currentIndex > 0) handleNavigate(navigationIds[currentIndex - 1])
                }}
            />
            <Button
                icon={<CaretDown size={14} />}
                size="small"
                type="text"
                disabled={isNextDisabled}
                onClick={() => {
                    if (currentIndex < navigationIds.length - 1)
                        handleNavigate(navigationIds[currentIndex + 1])
                }}
            />
        </div>
    )
})

// ================================================================
// ACTION BUTTONS (collapsed mode only)
// ================================================================

const VariantActionButtons = memo(({entityId}: {entityId: string}) => {
    const {renderPlaygroundButton, renderDeployButton} = useDrawerProviders()

    return (
        <div className="flex items-center gap-2">
            {renderPlaygroundButton?.(entityId)}
            {renderDeployButton?.(entityId)}
        </div>
    )
})

// ================================================================
// INFO POPOVER (expanded mode — shows metadata)
// ================================================================

const MetadataPopover = memo(({entityId}: {entityId: string}) => {
    const context = useAtomValue(workflowRevisionDrawerContextAtom)

    if (isCreateContext(context)) return null

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            styles={{container: {padding: 0}}}
            content={
                <div className="w-[240px]">
                    <MetadataSidebar revisionId={entityId} context={context} isCompact={true} />
                </div>
            }
        >
            <Button type="text" size="small" icon={<Info size={14} />} />
        </Popover>
    )
})

// ================================================================
// DRAWER TITLE
// ================================================================

const DRAWER_TITLES: Record<string, string> = {
    variant: "Workflow Revision",
    deployment: "Deployment",
    "evaluator-view": "Evaluator",
    "evaluator-create": "New Evaluator",
    "app-create": "New App",
}

// ================================================================
// APP-CREATE NAME INPUT (editable, inline in header)
// ================================================================

/**
 * Inline editable name input shown in the drawer header for `app-create`.
 * Reads the current name from `workflowMolecule.selectors.name(entityId)`
 * (draft-merged), writes via `workflowMolecule.actions.update`. The latest
 * value is what `createWorkflowFromEphemeralAtom` reads at commit time
 * (commit.ts:550 — `workflowName = name || entity.name || "Workflow"`).
 */
const AppCreateNameInput = memo(({entityId}: {entityId: string}) => {
    const currentName = useAtomValue(workflowMolecule.selectors.name(entityId))
    const updateWorkflow = useSetAtom(workflowMolecule.actions.update)
    const [localValue, setLocalValue] = useState(currentName ?? "")

    // Keep input in sync if the entity's name changes externally (e.g. on
    // initial entity hydration). Don't clobber while the user is typing.
    useEffect(() => {
        setLocalValue(currentName ?? "")
    }, [currentName])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value)
    }, [])

    const handleBlur = useCallback(() => {
        const trimmed = localValue.trim()
        // Persist the trimmed value whenever it differs from the current
        // (also-trimmed) name — including the empty-string case. Without
        // this, deleting the name and blurring would leave the workflow
        // entity holding the previous name silently while the input
        // appears blank.
        if (trimmed !== (currentName ?? "").trim()) {
            updateWorkflow(entityId, {name: trimmed})
        }
    }, [localValue, currentName, updateWorkflow, entityId])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur()
        }
    }, [])

    return (
        <Input
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            size="small"
            placeholder="Untitled App"
            className="!w-[260px] !text-sm !font-medium"
            data-testid="app-create-name-input"
            variant="borderless"
        />
    )
})

// ================================================================
// MAIN HEADER
// ================================================================

const DrawerHeader = () => {
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const context = useAtomValue(workflowRevisionDrawerContextAtom)
    const setExpanded = useSetAtom(workflowRevisionDrawerExpandedAtom)
    const closeDrawer = useSetAtom(closeWorkflowRevisionDrawerAtom)

    const handleClose = useCallback(() => closeDrawer(), [closeDrawer])
    const handleToggleExpand = useCallback(
        () => setExpanded(!isExpanded),
        [isExpanded, setExpanded],
    )

    const isCreate = isCreateContext(context)
    const isAppCreate = context === "app-create"
    const isEvaluator = context === "evaluator-view" || context === "evaluator-create"
    const title = DRAWER_TITLES[context] ?? "Workflow Revision"

    return (
        <div
            className="flex items-center justify-between px-4 py-4 border-0 border-b border-solid border-[#0517290F] shrink-0"
            data-testid="workflow-revision-drawer-header"
        >
            {/* Left: close + title + nav */}
            <div className="flex items-center gap-2">
                <Button
                    type="text"
                    size="small"
                    onClick={handleClose}
                    icon={<X size={14} />}
                    data-testid="workflow-revision-drawer-close"
                />

                <div className="flex items-center gap-3">
                    {isAppCreate && entityId ? (
                        <AppCreateNameInput entityId={entityId} />
                    ) : (
                        <Text className="text-sm font-medium">{title}</Text>
                    )}
                    {entityId && !isCreate && <NavControls entityId={entityId} />}
                </div>
            </div>

            {/* Right: actions + expand */}
            <div className="flex items-center gap-2">
                {isExpanded
                    ? entityId && <MetadataPopover entityId={entityId} />
                    : isCreate
                      ? null
                      : isEvaluator
                        ? null
                        : entityId && <VariantActionButtons entityId={entityId} />}
                <Button
                    onClick={handleToggleExpand}
                    size="small"
                    type="text"
                    icon={isExpanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                >
                    {isEvaluator ? "Test Evaluator" : "Test App"}
                </Button>
            </div>
        </div>
    )
}

export default memo(DrawerHeader)
