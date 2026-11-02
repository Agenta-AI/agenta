import {annotationSessionController, queueKindLabel} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {Badge} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {QueueAssignees} from "./QueueAssignees"
import {QueueConfigField} from "./QueueConfigField"
import {QueueConfigSection} from "./QueueConfigSection"
import {QueueDeleteCard} from "./QueueDeleteCard"
import {QueueEvaluatorCard} from "./QueueEvaluatorCard"

const ReadOnlyEditor = dynamic(() => import("./ReadOnlyEditor").then((m) => m.ReadOnlyEditor), {
    ssr: false,
})

const NO_VALUE = <span className="text-muted-foreground">—</span>

/**
 * The queue's settings, read only. The API has no route that edits a queue, so a name or
 * description field here could only change a local copy that a reload throws away.
 */
export const QueueConfigurationTab = ({
    queueId,
    canDelete,
    listHref,
}: {
    queueId: string
    canDelete: boolean
    listHref: string
}) => {
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
    const evaluatorIds = useAtomValue(annotationSessionController.selectors.evaluatorIds())
    const kind = queue?.data?.kind
    const kindLabel = queueKindLabel(kind)
    const description = queue?.description?.trim()

    return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted py-6">
            <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4">
                <QueueConfigSection title="General">
                    <div className="flex flex-col gap-3 p-4">
                        <QueueConfigField label="Name">{queue?.name || NO_VALUE}</QueueConfigField>
                        <QueueConfigField label="Description">
                            {description ? (
                                <ReadOnlyEditor
                                    id="queue-configuration-description"
                                    value={description}
                                />
                            ) : (
                                NO_VALUE
                            )}
                        </QueueConfigField>
                        <QueueConfigField label="Type">
                            {kindLabel ? (
                                <Badge variant={kind === "traces" ? "blue" : "green"}>
                                    {kindLabel}
                                </Badge>
                            ) : (
                                NO_VALUE
                            )}
                        </QueueConfigField>
                    </div>
                </QueueConfigSection>
                <QueueConfigSection title="Evaluators">
                    {evaluatorIds.length === 0 ? (
                        <p className="m-0 p-4 text-sm text-muted-foreground">
                            No evaluators configured for this queue.
                        </p>
                    ) : (
                        <div className="flex flex-col divide-y divide-border">
                            {evaluatorIds.map((id) => (
                                <QueueEvaluatorCard key={id} evaluatorId={id} />
                            ))}
                        </div>
                    )}
                </QueueConfigSection>
                <QueueConfigSection title="Collaborator settings">
                    <div className="flex flex-col gap-3 p-4">
                        <QueueConfigField label="Number of reviews per run">
                            {queue?.data?.repeats ?? 1}
                        </QueueConfigField>
                        <QueueConfigField label="Assignees">
                            <QueueAssignees assignments={queue?.data?.assignments} />
                        </QueueConfigField>
                    </div>
                </QueueConfigSection>
                {canDelete ? (
                    <QueueDeleteCard
                        queueId={queueId}
                        queueName={queue?.name}
                        listHref={listHref}
                    />
                ) : null}
            </div>
        </div>
    )
}
