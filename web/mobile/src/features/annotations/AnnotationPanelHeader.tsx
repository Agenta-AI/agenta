import {Badge} from "@agenta/ui/ui"

import {QueueDescriptionButton} from "./QueueDescriptionButton"

/**
 * "Annotations", the queue description when there is one, and whether this item is completed
 * (no `isCompleted`: no badge, as in a run, where the scenario status is shown elsewhere).
 */
export const AnnotationPanelHeader = ({
    description,
    isCompleted,
}: {
    description: string | null
    isCompleted?: boolean
}) => (
    <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-border px-3 py-2.5">
        <div className="flex items-center gap-1">
            <h2 className="m-0 text-sm font-medium text-foreground">Annotations</h2>
            {description ? <QueueDescriptionButton description={description} /> : null}
        </div>
        {isCompleted === undefined ? null : (
            <Badge variant={isCompleted ? "green" : "orange"}>
                {isCompleted ? "Completed" : "Incomplete"}
            </Badge>
        )}
    </div>
)
