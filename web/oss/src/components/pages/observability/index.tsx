import {useEffect, useMemo, useState} from "react"

import {Chats, TreeStructure} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    onboardingWidgetActivationAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {useQueryParamState} from "@/oss/state/appState"
import {observabilityTabAtom} from "@/oss/state/newObservability/atoms/controls"

import PageLayout from "../../PageLayout/PageLayout"

import ObservabilityTable from "./components/ObservabilityTable"
import SessionsTable from "./components/SessionsTable"

const SetupTracingModal = dynamic(
    () => import("@/oss/components/pages/app-management/modals/SetupTracingModal"),
    {ssr: false},
)

const ObservabilityTabs = () => {
    const [tabParam, setTabParam] = useQueryParamState("tab", "traces")
    const activeTab = (tabParam as "traces" | "sessions") || "traces"
    const [, setObservabilityTab] = useAtom(observabilityTabAtom)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const [isSetupTracingModalOpen, setIsSetupTracingModalOpen] = useState(false)

    useEffect(() => {
        setObservabilityTab(activeTab)
    }, [activeTab, setObservabilityTab])

    useEffect(() => {
        if (onboardingWidgetActivation !== "tracing-snippet") return
        setIsSetupTracingModalOpen(true)
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setOnboardingWidgetActivation])

    useEffect(() => {
        if (!isSetupTracingModalOpen) return
        recordWidgetEvent("tracing_setup_modal_opened")
    }, [isSetupTracingModalOpen, recordWidgetEvent])

    const tabItems = useMemo(() => {
        const size = 14

        return [
            {
                key: "traces",
                label: (
                    <span className="flex items-center gap-2">
                        <TreeStructure size={size} />
                        <span>Traces</span>
                    </span>
                ),
            },
            {
                key: "sessions",
                label: (
                    <span className="flex items-center gap-2">
                        <Chats size={size} />
                        <span>Sessions</span>
                    </span>
                ),
            },
        ]
    }, [])

    return (
        <PageLayout
            title={"Observability"}
            headerTabsProps={{
                items: tabItems,
                activeKey: activeTab,
                onChange: (key) => setTabParam(key),
            }}
        >
            <div className="flex flex-col gap-6">
                {activeTab === "traces" ? <ObservabilityTable /> : <SessionsTable />}
            </div>
            <SetupTracingModal
                open={isSetupTracingModalOpen}
                onCancel={() => setIsSetupTracingModalOpen(false)}
            />
        </PageLayout>
    )
}

export default ObservabilityTabs
