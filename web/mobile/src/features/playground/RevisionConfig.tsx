import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {ConfigPanel, RevisionSwitcher} from "@agenta/playground-ui/panels/config"

import {RevisionActions} from "./RevisionActions"

/**
 * One revision's config: its bar (switcher, Deploy, Commit, menu) and its editor. The single view
 * shows one; the compare view shows one per column, each with "Close panel" in its menu.
 */
export const RevisionConfig = ({
    workspaceId,
    projectId,
    appId,
    revisionId,
    readOnly,
    viewMode,
    onViewModeChange,
    onSwitch,
    onCommitted,
    onArchived,
    onClose,
}: {
    workspaceId: string
    projectId: string
    appId: string
    revisionId: string
    readOnly: boolean
    viewMode: ConfigViewMode
    onViewModeChange: (mode: ConfigViewMode) => void
    /** Shows another revision in place of this one. */
    onSwitch: (currentRevisionId: string, newRevisionId: string) => void
    /** A commit of this revision made a new revision. */
    onCommitted: (fromRevisionId: string, toRevisionId: string) => void
    onArchived: (revisionId: string) => void
    onClose?: (revisionId: string) => void
}) => (
    <ConfigPanel
        revisionId={revisionId}
        readOnly={readOnly}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        switcher={
            <RevisionSwitcher
                appId={appId}
                revisionId={revisionId}
                onSwitch={(id) => onSwitch(revisionId, id)}
            />
        }
        actions={
            <RevisionActions
                workspaceId={workspaceId}
                projectId={projectId}
                appId={appId}
                revisionId={revisionId}
                readOnly={readOnly}
                onCommitted={(id) => onCommitted(revisionId, id)}
                onArchived={onArchived}
                onClose={onClose ? () => onClose(revisionId) : undefined}
            />
        }
    />
)
