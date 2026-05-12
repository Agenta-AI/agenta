import type {SessionView} from "@agenta/annotation"
import type {EntitySelectionResult} from "@agenta/entity-ui"

export interface AnnotationSessionProps {
    queueId: string
    routeState: {
        view: SessionView
        scenarioId?: string
    }
    onActiveViewChange?: (view: SessionView) => void
    canExportData?: boolean
}

export interface AddToTestsetTargetSelection extends EntitySelectionResult<{
    testsetId: string
    testsetName: string
}> {
    type: "testset"
    metadata: {
        testsetId: string
        testsetName: string
    }
}

export interface SessionTitleProps {
    queueName: string
}

export interface SessionHeaderRightProps {
    activeView: SessionView
    onTabChange: (key: string) => void
}

export interface EmptyQueueStateProps {
    onViewChange: (view: SessionView) => void
}
