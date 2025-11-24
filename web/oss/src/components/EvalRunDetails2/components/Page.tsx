import {useEffect} from "react"

import {Tabs} from "antd"
import {useSetAtom} from "jotai"
import Router from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {legacyFocusDrawerEnabledAtom} from "@/oss/state/focusDrawerPreference"

import {activePreviewProjectIdAtom, activePreviewRunIdAtom} from "../atoms/run"
import {previewEvalTypeAtom} from "../state/evalType"
import {syncCompareStateFromUrl} from "../state/urlCompare"
import {syncFocusDrawerStateFromUrl} from "../state/urlFocusDrawer"
import EvalRunDetailsTable from "../Table"

import FocusDrawer from "./FocusDrawer"
import PreviewEvalRunHeader from "./PreviewEvalRunHeader"
import ConfigurationView from "./views/ConfigurationView"
import OverviewView from "./views/OverviewView"

type ViewKey = "overview" | "scenarios" | "configuration"

interface EvalRunPreviewPageProps {
    runId: string
    evaluationType: "auto" | "human"
    projectId?: string | null
}

const EvalRunPreviewPage = ({runId, evaluationType, projectId = null}: EvalRunPreviewPageProps) => {
    const setActiveRunId = useSetAtom(activePreviewRunIdAtom)
    const setEvalType = useSetAtom(previewEvalTypeAtom)
    const setActiveProjectId = useSetAtom(activePreviewProjectIdAtom)
    const setLegacyFocusDrawerEnabled = useSetAtom(legacyFocusDrawerEnabledAtom)

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

    const [activeViewParam, setActiveViewParam] = useQueryParam("view", "overview", "replace")
    const activeView = (activeViewParam as ViewKey) ?? "overview"

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
                    destroyInactiveTabPane
                    renderTabBar={() => <div style={{display: "none"}} />}
                    items={[
                        {
                            key: "overview",
                            label: "Overview",
                            children: (
                                <div className="h-full overflow-auto pr-2">
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
                    ]}
                />
            </div>
        </div>
    )
}

export default EvalRunPreviewPage
