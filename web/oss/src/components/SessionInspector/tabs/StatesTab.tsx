import {useQuery} from "@tanstack/react-query"
import {Alert, Descriptions, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchState} from "../api"

const {Text} = Typography

const StatesTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)

    const queryKey = ["session-inspector", "state", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchState(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load state" showIcon />
    if (!data) return <Text type="secondary">No durable state for this session yet.</Text>

    return (
        <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="state_id">
                <span className="font-mono text-xs">{data.id ?? "—"}</span>
            </Descriptions.Item>
            <Descriptions.Item label="sandbox_id">
                <span className="font-mono text-xs">{data.sandbox_id ?? "—"}</span>
            </Descriptions.Item>
            <Descriptions.Item label="updated_at">{data.updated_at ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="data">
                <pre className="m-0 max-h-[40vh] overflow-auto text-xs">
                    {JSON.stringify(data.data ?? {}, null, 2)}
                </pre>
            </Descriptions.Item>
        </Descriptions>
    )
}

export default StatesTab
