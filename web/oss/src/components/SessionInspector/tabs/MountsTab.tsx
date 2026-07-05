import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {WarningCircle} from "@phosphor-icons/react"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Empty, List} from "antd"
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

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/5" />
            </div>
        )
    if (error)
        return (
            <Alert variant="destructive" icon={<WarningCircle size={16} />}>
                <AlertTitle>Failed to load mounts</AlertTitle>
            </Alert>
        )

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
                <Button onClick={refresh} variant="ghost">
                    Refresh
                </Button>
            </div>
        </>
    )
}

export default MountsTab
