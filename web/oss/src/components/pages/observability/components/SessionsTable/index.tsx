import {useAtomValue} from "jotai"
import {useMemo} from "react"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {useObservability} from "@/oss/state/newObservability"

import ObservabilityHeader from "../ObservabilityHeader"

import {getSessionColumns, SessionRow} from "./assets/getSessionColumns"

const SessionsTable = () => {
    const {isLoading, selectedRowKeys, setSelectedRowKeys} = useObservability()

    const columns = useMemo(() => getSessionColumns(), [])

    const rowSelection = {
        selectedRowKeys,
        onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys)
        },
    }

    return (
        <div className="flex flex-col gap-6">
            <ObservabilityHeader columns={columns} componentType="sessions" />
            <div className="flex flex-col gap-2">
                <EnhancedTable
                    uniqueKey="observability-sessions-table"
                    rowKey="session_id"
                    columns={columns}
                    dataSource={[]}
                    loading={isLoading}
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        ...rowSelection,
                    }}
                />
            </div>
        </div>
    )
}

export default SessionsTable
