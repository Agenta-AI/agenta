import {annotationSessionController, queueKindLabel} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {Badge} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {QueueAssignees} from "./QueueAssignees"
import {QueueConfigField} from "./QueueConfigField"
import {QueueConfigSection} from "./QueueConfigSection"
import {QueueDeleteCard} from "./QueueDeleteCard"
import {QueueDetailsForm} from "./QueueDetailsForm"
import {QueueEvaluatorCard} from "./QueueEvaluatorCard"

const ReadOnlyEditor = dynamic(() => import("./ReadOnlyEditor").then((m) => m.ReadOnlyEditor), {
    ssr: false,
})

const NO_VALUE = <span className="text-muted-foreground">—</span>

/**
 * The queue's settings. In beta developer mode a user who may edit queues can change the name
 * and description and delete the queue; everyone else reads them.
 */
export const QueueConfigurationTab = ({
    queueId,
    canEdit,
    listHref,
}: {
    queueId: string
    /** The user may edit and delete queues in this project. */
    canEdit: boolean
    listHref: string
}) => {
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const evaluatorRevisionIds = useAtomValue(
        annotationSessionController.selectors.evaluatorRevisionIds(),
    )
    const kind = queue?.data?.kind
    const kindLabel = queueKindLabel(kind)
    const description = queue?.description?.trim()

    return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted py-6">
            <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4">
                <QueueConfigSection title="General">
                    <div className="flex flex-col gap-3 p-4">
                        {beta && canEdit ? (
                            <QueueDetailsForm
                                queueId={queueId}
                                savedName={queue?.name ?? ""}
                                savedDescription={queue?.description ?? ""}
                            />
                        ) : (
                            <>
                                <QueueConfigField label="Name">
                                    {queue?.name || NO_VALUE}
                                </QueueConfigField>
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
                            </>
                        )}
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
                    {evaluatorRevisionIds.length === 0 ? (
                        <p className="m-0 p-4 text-sm text-muted-foreground">
                            No evaluators configured for this queue.
                        </p>
                    ) : (
                        <div className="flex flex-col divide-y divide-border">
                            {evaluatorRevisionIds.map((id) => (
                                <QueueEvaluatorCard key={id} revisionId={id} />
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
                {canEdit ? (
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
