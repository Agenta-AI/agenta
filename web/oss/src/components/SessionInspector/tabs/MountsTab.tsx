import {useQuery} from "@tanstack/react-query"
import {Alert, Empty, List, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchMounts} from "../api"

const {Text} = Typography

const MountsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const {data, isLoading, error} = useQuery({
        queryKey: ["session-inspector", "mounts", projectId, sessionId],
        queryFn: () => fetchMounts(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load mounts" showIcon />

    const mounts = data?.mounts ?? []
    if (!mounts.length) return <Empty description="No mounts bound to this session" />

    return (
        <List
            size="small"
            dataSource={mounts}
            renderItem={(mount) => (
                <List.Item>
                    <List.Item.Meta
                        title={mount.name ?? mount.slug ?? mount.id}
                        description={
                            <Text type="secondary" className="text-xs font-mono">
                                {mount.id}
                            </Text>
                        }
                    />
                </List.Item>
            )}
        />
    )
}

export default MountsTab
