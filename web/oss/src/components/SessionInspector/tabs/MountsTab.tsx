import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Button, Empty, List, Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchMounts} from "../api"

const MountsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()

    const queryKey = ["session-inspector", "mounts", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchMounts(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    const refresh = () => queryClient.invalidateQueries({queryKey})

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load mounts" showIcon />

    const mounts = data?.mounts ?? []
    if (!mounts.length) return <Empty description="No mounts bound to this session" />

    return (
        <>
            <List
                size="small"
                dataSource={mounts}
                renderItem={(mount) => (
                    <List.Item>
                        <List.Item.Meta
                            title={mount.name ?? mount.slug ?? mount.id}
                            description={
                                <span className="text-xs font-mono text-muted-foreground">
                                    {mount.id}
                                </span>
                            }
                        />
                    </List.Item>
                )}
            />
            <div className="mt-2">
                <Button type="text" onClick={refresh}>
                    Refresh
                </Button>
            </div>
        </>
    )
}

export default MountsTab
