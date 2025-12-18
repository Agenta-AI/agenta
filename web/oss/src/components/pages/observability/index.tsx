import {useMemo} from "react"

import {Chats, TreeStructure} from "@phosphor-icons/react"
import {Tabs, Typography} from "antd"

import {useQueryParamState} from "@/oss/state/appState"

import ObservabilityTable from "./components/ObservabilityTable"
import ObservabilityUrlSyncer from "./components/ObservabilityUrlSyncer"
import SessionsTable from "./components/SessionsTable"

const ObservabilityTabs = () => {
    const [tabParam, setTabParam] = useQueryParamState("tab", "traces")
    const activeTab = (tabParam as "traces" | "sessions") || "traces"

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
        <div className="flex flex-col gap-6">
            <ObservabilityUrlSyncer />
            <div className="flex items-center justify-between">
                <Typography.Text className="text-[16px] font-medium">Observability</Typography.Text>
                <Tabs activeKey={activeTab} onChange={(key) => setTabParam(key)} items={tabItems} />
            </div>

            {activeTab === "traces" ? <ObservabilityTable /> : <SessionsTable />}
        </div>
    )
}

export default ObservabilityTabs
