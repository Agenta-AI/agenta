import {useCallback, useEffect, useMemo} from "react"

import {registerAnnotationCallbacks} from "@agenta/annotation"
import type {SessionView} from "@agenta/annotation"
import {
    AnnotationUIProvider,
    type AnnotationUINavigation,
    type MetricPopoverWrapperProps,
} from "@agenta/annotation-ui/context"
import AnnotationSession from "@agenta/annotation-ui/session"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import AnnotationTestcaseContent from "@/oss/components/Annotations/AnnotationTestcaseContent"
import AnnotationTraceContent from "@/oss/components/Annotations/AnnotationTraceContent"
import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import {
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import useURL from "@/oss/hooks/useURL"
import {useAppNavigation, useQueryParamState} from "@/oss/state/appState"

const isSessionView = (value: string | undefined): value is SessionView => {
    return value === "list" || value === "annotate" || value === "configuration"
}

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
    const appNavigation = useAppNavigation()
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const setTraceDrawerActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const [viewParam, setViewParam] = useQueryParamState("view", "annotate")
    const [scenarioIdParam, setScenarioIdParam] = useQueryParamState("scenarioId")
    const normalizedViewParam = Array.isArray(viewParam) ? viewParam[0] : viewParam
    const activeView = isSessionView(normalizedViewParam) ? normalizedViewParam : "annotate"
    const activeScenarioId = Array.isArray(scenarioIdParam) ? scenarioIdParam[0] : scenarioIdParam
    const handleActiveViewChange = useCallback(
        (view: SessionView) => {
            setViewParam(view, {method: "replace"})
        },
        [setViewParam],
    )
    const handleScenarioChange = useCallback(
        (scenarioId: string) => {
            setScenarioIdParam(scenarioId, {method: "replace"})
        },
        [setScenarioIdParam],
    )

    const handleOpenTraceDetail = useCallback(
        ({traceId, spanId}: {traceId: string; spanId?: string | null}) => {
            const activeSpanId = spanId ?? null
            openTraceDrawer({traceId, activeSpanId})
            setTraceDrawerActiveSpan(activeSpanId)
            appNavigation.setQueryParam("trace", traceId, {shallow: true})
            if (activeSpanId) {
                appNavigation.setQueryParam("span", activeSpanId, {shallow: true})
            } else {
                appNavigation.removeQueryParam("span", {shallow: true})
            }
        },
        [appNavigation, openTraceDrawer, setTraceDrawerActiveSpan],
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

    useEffect(() => {
        registerAnnotationCallbacks({
            onNavigate: handleScenarioChange,
        })

        return () => {
            registerAnnotationCallbacks({})
        }
    }, [handleScenarioChange])

    const routeState = useMemo(
        () => ({
            view: activeView,
            scenarioId: activeScenarioId,
        }),
        [activeScenarioId, activeView],
    )

    if (!queueId) return null

    return (
        <AnnotationUIProvider
            navigation={navigation}
            TraceContentRenderer={AnnotationTraceContent}
            TestcaseContentRenderer={AnnotationTestcaseContent}
            MetricPopoverWrapper={AnnotationMetricPopover}
        >
            <AnnotationSession
                queueId={queueId}
                routeState={routeState}
                onActiveViewChange={handleActiveViewChange}
            />
        </AnnotationUIProvider>
    )
}

export default AnnotationSessionPage
