import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {hasPendingHydrationAtomFamily} from "@agenta/playground"
import {useAtomValue} from "jotai"

import {ConfigPanelHeader} from "./ConfigPanelHeader"
import {ConfigPanelSkeleton} from "./ConfigPanelSkeleton"

/** The header is 48px tall and sticky, so the config's own section headers stick below it. */
const HEADER_HEIGHT = 48

export interface ConfigPanelProps {
    revisionId: string
    /** Form, JSON or YAML. The screen keeps it, so it lasts while the page is open. */
    viewMode: ConfigViewMode
    onViewModeChange: (mode: ConfigViewMode) => void
}

/**
 * One revision's config in the prompt playground: the header bar, then the shared config editor.
 * Edits go to the revision's local draft through the editor itself.
 *
 * The editor waits while a shared link still has draft edits to apply to this revision, so it
 * never shows the saved config first and then jumps.
 */
export const ConfigPanel = ({revisionId, viewMode, onViewModeChange}: ConfigPanelProps) => {
    const hasPendingHydration = useAtomValue(hasPendingHydrationAtomFamily(revisionId))

    return (
        <section className="flex flex-col">
            <ConfigPanelHeader
                revisionId={revisionId}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
            />
            {hasPendingHydration ? (
                <ConfigPanelSkeleton />
            ) : (
                <PlaygroundConfigSection
                    revisionId={revisionId}
                    viewMode={viewMode}
                    stickyHeaderTop={HEADER_HEIGHT}
                />
            )}
        </section>
    )
}
