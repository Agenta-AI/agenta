import {useMemo, type ReactNode} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {Badge} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {usePlaygroundNodeLabels} from "../../hooks/usePlaygroundNodeLabels"

export interface RevisionResultCardProps {
    /** The revision whose output the card holds: its name and version label the card. */
    entityId: string
    children: ReactNode
    className?: string
}

/**
 * A bordered card around one revision's output, as in the old playground: the revision's name
 * and version sit on the top border ("Workflow v5"), with an amber "draft" tag while the revision
 * has unsaved edits.
 */
export const RevisionResultCard = ({entityId, children, className}: RevisionResultCardProps) => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const node = nodes.find((candidate) => candidate.entityId === entityId) ?? null
    // A stable list: the hook builds its atom from it.
    const labelNodes = useMemo(() => (node ? [node] : null), [node])
    const {getNodeLabel} = usePlaygroundNodeLabels(labelNodes)
    const data = useAtomValue(useMemo(() => workflowMolecule.selectors.data(entityId), [entityId]))
    const isDirty = useAtomValue(
        useMemo(() => workflowMolecule.selectors.isDirty(entityId), [entityId]),
    )
    const version = data?.version as number | undefined
    const name = node ? getNodeLabel(node) : "Output"

    return (
        <div
            data-testid="revision-result-card"
            className={["relative pt-[11px]", className].filter(Boolean).join(" ")}
        >
            <div className="absolute left-2.5 top-0 z-[1] flex items-center gap-1 bg-background px-1">
                <Badge>
                    {name}
                    {version != null ? (
                        <span className="ml-1 text-muted-foreground">v{version}</span>
                    ) : null}
                </Badge>
                {isDirty ? <Badge variant="draft">draft</Badge> : null}
            </div>
            <div className="min-w-0 rounded-lg border border-solid border-border px-3 pb-2 pt-6 text-sm">
                {children}
            </div>
        </div>
    )
}
