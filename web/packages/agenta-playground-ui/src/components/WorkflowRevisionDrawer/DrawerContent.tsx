/**
 * DrawerContent
 *
 * Content area for the workflow revision drawer.
 *
 * The drawer IS a playground — the playgroundContent prop renders
 * PlaygroundMainView which toggles between configOnly and full
 * viewMode based on the expanded atom. No component swapping.
 *
 * Collapsed mode: playground (configOnly) + MetadataSidebar
 * Expanded mode:  playground (full, with execution panel)
 */
import {memo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import MetadataSidebar from "./MetadataSidebar"
import {workflowRevisionDrawerContextAtom, workflowRevisionDrawerExpandedAtom} from "./store"

const EMPTY_ID = "__workflow-drawer-empty__"

// ================================================================
// LOADING STATE (exported for external use, e.g., disabling nav buttons)
// ================================================================

export const drawerIsLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        if (!revisionId || revisionId === EMPTY_ID) return true
        const entity = get(workflowMolecule.selectors.data(revisionId))
        if (!entity) {
            const query = get(workflowMolecule.atoms.query(revisionId))
            return query.isPending
        }
        return false
    }),
)

// ================================================================
// MAIN CONTENT
// ================================================================

interface DrawerContentProps {
    entityId: string
    /** Playground content — always mounted, toggles between configOnly and full */
    playgroundContent?: React.ReactNode
}

const DrawerContent = ({entityId, playgroundContent}: DrawerContentProps) => {
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const context = useAtomValue(workflowRevisionDrawerContextAtom)

    const showMetadata = !isExpanded && context !== "evaluator-create"

    return (
        <section className="flex w-full h-full overflow-hidden">
            {/* Playground — always mounted */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{playgroundContent}</div>

            {/* Metadata sidebar — only in collapsed mode */}
            {showMetadata && <MetadataSidebar revisionId={entityId} context={context} />}
        </section>
    )
}

export default memo(DrawerContent)
