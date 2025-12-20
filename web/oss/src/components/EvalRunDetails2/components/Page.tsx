import {useEffect, useMemo} from "react"

import {Tabs} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import Router from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"

import PageLayout from "../../PageLayout/PageLayout"
import {activePreviewProjectIdAtom, activePreviewRunIdAtom} from "../atoms/run"
import {runDisplayNameAtomFamily, runStatusAtomFamily} from "../atoms/runDerived"
import {previewEvalTypeAtom} from "../state/evalType"
import {syncCompareStateFromUrl} from "../state/urlCompare"
import {syncFocusDrawerStateFromUrl} from "../state/urlFocusDrawer"
import EvalRunDetailsTable from "../Table"

import PreviewEvalRunTabs, {PreviewEvalRunMeta} from "./PreviewEvalRunHeader"
import ConfigurationView from "./views/ConfigurationView"
import FocusView from "./views/FocusView"
import OverviewView from "./views/OverviewView"

type ViewKey = "overview" | "focus" | "scenarios" | "configuration"

interface EvalRunPreviewPageProps {
    runId: string
    evaluationType: "auto" | "human" | "online"
    projectId?: string | null
}

const EvalRunPreviewPage = ({runId, evaluationType, projectId = null}: EvalRunPreviewPageProps) => {
    const setActiveRunId = useSetAtom(activePreviewRunIdAtom)
    const setEvalType = useSetAtom(previewEvalTypeAtom)
    const setActiveProjectId = useSetAtom(activePreviewProjectIdAtom)
    const {projectURL} = useURL()

    // Get the run display name for breadcrumbs
    const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
    const runDisplayName = useAtomValue(runDisplayNameAtom)

    // Get the run status to determine default view for human evaluations
    const runStatusAtom = useMemo(() => runStatusAtomFamily(runId), [runId])
    const runStatus = useAtomValue(runStatusAtom)

    // Map evaluation type to display label and URL kind parameter
    // Labels match EvaluationsView.tsx tab labels
    const evaluationTypeBreadcrumb = useMemo(() => {
        const typeMap: Record<string, {label: string; kind: string}> = {
            auto: {label: "Auto Evals", kind: "auto"},
            human: {label: "Human Evals", kind: "human"},
            online: {label: "Online Evals", kind: "online"},
        }
        const config = typeMap[evaluationType] ?? {label: "Evaluations", kind: "auto"}
        return {
            label: config.label,
            href: projectURL ? `${projectURL}/evaluations?kind=${config.kind}` : undefined,
        }
    }, [evaluationType, projectURL])

    // Set breadcrumbs: workspace / project / evaluations [type] (link) / evaluation name
    // Use "appPage" for evaluation type and "appPageDetail" for evaluation name
    // to match the breadcrumb system's expected key ordering
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                appPage: {
                    label: evaluationTypeBreadcrumb.label,
                    href: evaluationTypeBreadcrumb.href,
                },
                appPageDetail: {
                    label: runDisplayName || "results",
                    value: runId,
                },
            },
            type: "append",
            condition: Boolean(runId),
        },
        [runId, runDisplayName, evaluationTypeBreadcrumb],
    )

    useEffect(() => {
        setActiveRunId(runId)
        setEvalType(evaluationType)
        setActiveProjectId(projectId)
        return () => {
            setActiveRunId(null)
            setEvalType(null)
            setActiveProjectId(null)
        }
    }, [runId, evaluationType, projectId, setActiveProjectId, setActiveRunId, setEvalType])

    useEffect(() => {
        const handleRouteChange = (url: string) => {
            syncFocusDrawerStateFromUrl(url)
            syncCompareStateFromUrl(url)
        }

        syncFocusDrawerStateFromUrl()
        syncCompareStateFromUrl()
        Router.events.on("routeChangeComplete", handleRouteChange)
        return () => {
            Router.events.off("routeChangeComplete", handleRouteChange)
        }
    }, [])

    // For human evaluations: show "focus" (annotation) view if not in terminal status, otherwise "overview"
    // Terminal statuses indicate the evaluation is complete and results should be shown
    const isTerminalStatus = useMemo(() => {
        if (!runStatus) return false
        const terminalStatuses = [
            "EVALUATION_FINISHED",
            "EVALUATION_FINISHED_WITH_ERRORS",
            "EVALUATION_FAILED",
            "EVALUATION_AGGREGATION_FAILED",
            "success",
            "failure",
            "failed",
            "errors",
            "cancelled",
        ]
        return terminalStatuses.includes(runStatus)
    }, [runStatus])

    const defaultView =
        evaluationType === "human" ? (isTerminalStatus ? "overview" : "focus") : "overview"
    const [activeViewParam, setActiveViewParam] = useQueryParam("view", defaultView, "replace")
    const activeView = (activeViewParam as ViewKey) ?? defaultView

    return (
        <PageLayout
            className="!p-0 h-full min-h-0"
            title={runDisplayName}
            headerExtra={
                <PreviewEvalRunTabs
                    activeView={activeView}
                    onChangeView={(v) => setActiveViewParam(v)}
                />
            }
            headerClassName="px-2"
        >
            <div className="flex h-full min-h-0 flex-col gap-3 [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full">
                <PreviewEvalRunMeta runId={runId} projectId={projectId} />
                <Tabs
                    className="flex-1 min-h-0 overflow-hidden"
                    activeKey={activeView}
                    onChange={(key) => setActiveViewParam(key)}
                    destroyOnHidden
                    renderTabBar={() => <div style={{display: "none"}} />}
                    items={[
                        {
                            key: "overview",
                            label: "Overview",
                            children: (
                                <div className="h-full overflow-auto">
                                    <OverviewView runId={runId} />
                                </div>
                            ),
                        },
                        {
                            key: "scenarios",
                            label: "Scenarios",
                            children: (
                                <div className="h-full min-h-0">
                                    <EvalRunDetailsTable
                                        runId={runId}
                                        evaluationType={evaluationType}
                                        projectId={projectId}
                                    />
                                </div>
                            ),
                        },
                        {
                            key: "configuration",
                            label: "Configuration",
                            children: (
                                <div className="h-full overflow-auto pr-2">
                                    <ConfigurationView runId={runId} />
                                </div>
                            ),
                        },
                        ...(evaluationType === "human"
                            ? [
                                  {
                                      key: "focus",
                                      label: "Focus",
                                      children: (
                                          <div className="h-full min-h-0">
                                              <FocusView runId={runId} />
                                          </div>
                                      ),
                                  } satisfies (typeof Tabs)["prototype"]["props"]["items"][number],
                              ]
                            : []),
                    ]}
                />
            </div>
        </PageLayout>
    )
}

export default EvalRunPreviewPage
