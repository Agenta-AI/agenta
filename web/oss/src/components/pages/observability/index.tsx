import {useMemo, useState} from "react"

import {Chats, TreeStructure} from "@phosphor-icons/react"
import {Tabs, Typography} from "antd"

import ObservabilityTable from "./components/ObservabilityTable"
import SessionsTable from "./components/SessionsTable"

const ObservabilityTabs = () => {
    const [activeTab, setActiveTab] = useState<"traces" | "sessions">("traces")

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
            <div className="flex items-center justify-between">
                <Typography.Text className="text-[16px] font-medium">Observability</Typography.Text>
                <Tabs
                    activeKey={activeTab}
                    onChange={(key) => setActiveTab(key as "traces" | "sessions")}
                    items={tabItems}
                />
            </div>

            {activeTab === "traces" ? <ObservabilityTable /> : <SessionsTable />}
        </div>
    )
}

export default ObservabilityTabs
