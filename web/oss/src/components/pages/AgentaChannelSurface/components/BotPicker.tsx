import {Select} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {agentaConnectionsQueryAtom, selectedConnectionIdAtom} from "../state"

export default function BotPicker() {
    const query = useAtomValue(agentaConnectionsQueryAtom)
    const [selectedConnectionId, setSelectedConnectionId] = useAtom(selectedConnectionIdAtom)
    const connections = query.data ?? []

    return (
        <Select
            className="min-w-[220px]"
            placeholder="Pick a bot"
            loading={query.isPending}
            value={selectedConnectionId ?? undefined}
            onChange={setSelectedConnectionId}
            options={connections.map((connection) => ({
                label: connection.name || connection.slug || connection.id,
                value: connection.id,
            }))}
            notFoundContent="No Agenta bots yet -- create one below."
        />
    )
}
