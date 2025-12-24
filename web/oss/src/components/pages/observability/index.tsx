import {useEffect, useMemo} from "react"

import {Chats, TreeStructure} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {useQueryParamState} from "@/oss/state/appState"
import {observabilityTabAtom} from "@/oss/state/newObservability/atoms/controls"

import PageLayout from "../../PageLayout/PageLayout"

import ObservabilityTable from "./components/ObservabilityTable"
import SessionsTable from "./components/SessionsTable"

const ObservabilityTabs = () => {
    const [tabParam, setTabParam] = useQueryParamState("tab", "traces")
    const activeTab = (tabParam as "traces" | "sessions") || "traces"
    const [, setObservabilityTab] = useAtom(observabilityTabAtom)

    useEffect(() => {
        setObservabilityTab(activeTab)
    }, [activeTab, setObservabilityTab])

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
        </PageLayout>
    )
}

export default ObservabilityTabs
