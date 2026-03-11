import {useCallback, useMemo} from "react"

import {
    AnnotationUIProvider,
    type AnnotationUINavigation,
    type MetricPopoverWrapperProps,
} from "@agenta/annotation-ui/context"
import AnnotationSession from "@agenta/annotation-ui/session"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import AnnotationTraceContent from "@/oss/components/Annotations/AnnotationTraceContent"
import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import useURL from "@/oss/hooks/useURL"

const AnnotationMetricPopover = ({children, ...props}: MetricPopoverWrapperProps) => (
    <MetricDetailsPreviewPopover
        runId={props.runId}
        metricKey={props.metricKey}
        metricPath={props.metricPath}
        metricLabel={props.metricLabel}
        stepKey={props.stepKey}
        stepType={props.stepType}
        highlightValue={props.highlightValue}
        fallbackValue={props.fallbackValue}
        evaluationType={props.evaluationType as "human" | undefined}
        prefetchedStats={props.prefetchedStats as any}
    >
        {children}
    </MetricDetailsPreviewPopover>
)

const AnnotationSessionPage = () => {
    const router = useRouter()
    const {projectURL} = useURL()
    const queueId = router.query.queue_id as string | undefined
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    const handleOpenTraceDetail = useCallback(
        (traceId: string, spanId?: string) => {
            openTraceDrawer({traceId, activeSpanId: spanId ?? null})
        },
        [openTraceDrawer],
    )

    const navigation = useMemo<AnnotationUINavigation>(
        () => ({
            navigateToQueue: (id: string) => router.push(`${projectURL}/annotations/${id}`),
            navigateToQueueList: () => router.push(`${projectURL}/annotations`),
            navigateToResults: (runId: string) =>
                router.push(`${projectURL}/evaluations/results/${runId}`),
            navigateToObservability: () => router.push(`${projectURL}/observability`),
            openTraceDetail: handleOpenTraceDetail,
        }),
        [router, projectURL, handleOpenTraceDetail],
    )

    if (!queueId) return null

    return (
        <AnnotationUIProvider
            navigation={navigation}
            TraceContentRenderer={AnnotationTraceContent}
            MetricPopoverWrapper={AnnotationMetricPopover}
        >
            <AnnotationSession queueId={queueId} />
        </AnnotationUIProvider>
    )
}

export default AnnotationSessionPage
