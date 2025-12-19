import {useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {SessionDrawer} from "@/oss/components/SharedDrawers/SessionDrawer"
import {sessionIdsAtom, useObservability} from "@/oss/state/newObservability"
import {openSessionDrawerWithUrlAtom} from "@/oss/state/url/session"

import ObservabilityHeader from "../ObservabilityHeader"

import {getSessionColumns, SessionRow} from "./assets/getSessionColumns"

const SessionsTable = () => {
    const {isLoading, selectedRowKeys, setSelectedRowKeys} = useObservability()
    const openSessionDrawer = useSetAtom(openSessionDrawerWithUrlAtom)
    const sessionIds = useAtomValue(sessionIdsAtom)
    const columns = useMemo(() => getSessionColumns(), [])

    const dataSource: SessionRow[] = useMemo(
        () => sessionIds.map((id) => ({session_id: id})),
        [sessionIds],
    )

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
                    dataSource={dataSource}
                    loading={isLoading}
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        ...rowSelection,
                    }}
                    onRow={(record) => ({
                        onClick: () => openSessionDrawer({sessionId: record.session_id}),
                        className: "cursor-pointer",
                    })}
                />
            </div>
            <SessionDrawer />
        </div>
    )
}

export default SessionsTable
