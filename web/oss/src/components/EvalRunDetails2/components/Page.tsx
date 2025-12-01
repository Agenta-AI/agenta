import {useEffect, useMemo} from "react"

import {Tabs} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import Router from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {legacyFocusDrawerEnabledAtom} from "@/oss/state/focusDrawerPreference"

import {activePreviewProjectIdAtom, activePreviewRunIdAtom} from "../atoms/run"
import {runDisplayNameAtomFamily} from "../atoms/runDerived"
import {previewEvalTypeAtom} from "../state/evalType"
import {syncCompareStateFromUrl} from "../state/urlCompare"
import {syncFocusDrawerStateFromUrl} from "../state/urlFocusDrawer"
import EvalRunDetailsTable from "../Table"

import PreviewEvalRunHeader from "./PreviewEvalRunHeader"
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
    const setLegacyFocusDrawerEnabled = useSetAtom(legacyFocusDrawerEnabledAtom)
    const {projectURL} = useURL()

    // Get the run display name for breadcrumbs
    const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
    const runDisplayName = useAtomValue(runDisplayNameAtom)

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
        setLegacyFocusDrawerEnabled(false)
        return () => {
            setActiveRunId(null)
            setEvalType(null)
            setActiveProjectId(null)
            setLegacyFocusDrawerEnabled(true)
        }
    }, [
        runId,
        evaluationType,
        projectId,
        setActiveProjectId,
        setActiveRunId,
        setEvalType,
        setLegacyFocusDrawerEnabled,
    ])

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

    const defaultView = "overview"
    const [activeViewParam, setActiveViewParam] = useQueryParam("view", defaultView, "replace")
    const activeView = (activeViewParam as ViewKey) ?? defaultView

    return (
        <div className="flex h-full min-h-0 flex-col">
            <PreviewEvalRunHeader
                runId={runId}
                activeView={activeView}
                onChangeView={(v) => setActiveViewParam(v)}
            />

            <div className="flex h-full min-h-0 flex-col gap-3 [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full">
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
        </div>
    )
}

export default EvalRunPreviewPage
