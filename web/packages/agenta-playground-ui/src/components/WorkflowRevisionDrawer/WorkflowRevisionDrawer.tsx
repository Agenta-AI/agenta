/**
 * WorkflowRevisionDrawer
 *
 * Unified drawer for viewing/editing workflow revisions (both variants and evaluators).
 *
 * Architecture:
 * - This component renders the shell (Drawer + header).
 * - OSS provides concrete components via DrawerProvidersProvider.
 * - The drawer IS a playground — playgroundContent is always mounted.
 * - Collapsed: playground in configOnly mode + metadata sidebar.
 * - Expanded: playground in full mode (config + execution panels).
 *
 * Close-on-outside-click:
 * - Clicks on `.ant-layout` (main content area behind drawer) close the drawer.
 * - Clicks on `.variant-table-row` are ignored — the row click handler sets the
 *   URL param, which swaps drawer content without closing.
 */
import {memo, useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {Drawer} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import DrawerContent from "./DrawerContent"
import DrawerHeader from "./DrawerHeader"
import {
    closeWorkflowRevisionDrawerAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerOpenAtom,
} from "./store"

interface WorkflowRevisionDrawerProps {
    /** Playground content — always mounted, toggles viewMode on expand */
    playgroundContent?: ReactNode
}

const WorkflowRevisionDrawer = ({playgroundContent}: WorkflowRevisionDrawerProps) => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const closeDrawer = useSetAtom(closeWorkflowRevisionDrawerAtom)
    const [shouldRender, setShouldRender] = useState(!!isOpen)

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true)
        }
    }, [isOpen])

    // Close drawer on clicks outside (on .ant-layout), but ignore table row clicks
    // Track when the drawer opens to prevent immediate close from stale click events
    const openTimestampRef = useRef(0)
    useEffect(() => {
        if (isOpen) {
            openTimestampRef.current = Date.now()
        }
    }, [isOpen])

    useEffect(() => {
        if (!shouldRender) return

        function handleClickOutside(event: MouseEvent) {
            // Ignore clicks that happen within 300ms of the drawer opening
            // to prevent race conditions with popover close → layout click propagation
            if (Date.now() - openTimestampRef.current < 300) return

            const target = event.target as HTMLElement
            // Ignore clicks on table rows — those swap drawer content via URL
            if (target.closest(".variant-table-row")) return
            // Ignore clicks inside any drawer (e.g. trace drawer, focus drawer)
            // to prevent this drawer from closing when another drawer opens on top
            if (target.closest(".ant-drawer")) return
            // Ignore clicks on popovers (e.g. evaluator template dropdown)
            if (target.closest(".ant-popover")) return
            // Ignore clicks on modals
            if (target.closest(".ant-modal-root")) return
            // Close when clicking the main layout area behind the drawer
            if (target.closest(".ant-layout")) {
                closeDrawer()
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => document.removeEventListener("click", handleClickOutside)
    }, [shouldRender, closeDrawer])

    const handleAfterOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setShouldRender(false)
        }
    }, [])

    if (!shouldRender) return null

    return (
        <Drawer
            open={isOpen}
            closable={false}
            mask={false}
            destroyOnHidden
            afterOpenChange={handleAfterOpenChange}
            styles={{
                body: {padding: 0},
                wrapper: {width: isExpanded ? "clamp(1155px, 92vw, 1600px)" : 1100},
            }}
        >
            {isOpen && entityId && (
                <div className="flex flex-col w-full h-full overflow-hidden">
                    <DrawerHeader />
                    <DrawerContent entityId={entityId} playgroundContent={playgroundContent} />
                </div>
            )}
        </Drawer>
    )
}

export default memo(WorkflowRevisionDrawer)
