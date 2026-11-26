import {annotationSessionController, type SessionView} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {FocusView} from "./FocusView"
import {QueueConfigurationTab} from "./QueueConfigurationTab"
import {ScenarioListTab} from "./ScenarioListTab"
import {QueueEmpty} from "./states/QueueEmpty"
import {QueueNotFound} from "./states/QueueNotFound"
import {QueueSessionSkeleton} from "./states/QueueSessionSkeleton"

/**
 * The tab body with its states. A failed request shows a retry and never reads as "not found" or
 * "empty"; Configuration does not need the items, so it shows even when they fail to load.
 */
export const QueueSessionBody = ({
    queueId,
    base,
    view,
    canEdit,
    onViewChange,
}: {
    queueId: string
    /** `/w/:workspace/p/:project` */
    base: string
    view: SessionView
    canEdit: boolean
    onViewChange: (view: SessionView) => void
}) => {
    const queueQuery = useAtomValue(simpleQueueMolecule.selectors.query(queueId))
    const queue = queueQuery.data
    const activeQueueId = useAtomValue(annotationSessionController.selectors.activeQueueId())
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())
    const scenarioCount = useAtomValue(annotationSessionController.selectors.scenarioIds()).length
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())

    // Until the controller has opened this queue its item query reads as idle, not pending.
    const sessionOpening = activeQueueId !== queueId
    if (queueQuery.isPending || (queue && (sessionOpening || scenariosQuery.isPending))) {
        return <QueueSessionSkeleton />
    }
    if (!queue && queueQuery.isError) {
        return (
            <LoadError
                title="Could not load this queue"
                onRetry={() => simpleQueueMolecule.cache.invalidateDetail(queueId)}
            />
        )
    }
    if (!queue) return <QueueNotFound listHref={`${base}/annotations`} />

    if (view === "configuration") {
        return (
            <QueueConfigurationTab
                queueId={queueId}
                canEdit={canEdit}
                listHref={`${base}/annotations`}
            />
        )
    }
    if (scenariosQuery.isError) {
        return (
            <LoadError
                title="Could not load the items in this queue"
                onRetry={() => simpleQueueMolecule.cache.invalidateProgress(queueId)}
            />
        )
    }
    if (scenarioCount === 0) {
        return (
            <QueueEmpty
                isTraces={queueKind === "traces"}
                observabilityHref={`${base}/observability`}
            />
        )
    }
    if (view === "list") return <ScenarioListTab queueId={queueId} onViewChange={onViewChange} />
    return <FocusView queueId={queueId} observabilityHref={`${base}/observability`} />
}
