import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {WarningCircle} from "@phosphor-icons/react"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Descriptions} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchState} from "../api"

const StatesTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()

    const queryKey = ["session-inspector", "state", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchState(sessionId, projectId),
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
                <AlertTitle>Failed to load state</AlertTitle>
            </Alert>
        )
    if (!data)
        return <span className="text-muted-foreground">No durable state for this session yet.</span>

    return (
        <>
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
            <div className="mt-2">
                <Button onClick={refresh} variant="ghost">
                    Refresh
                </Button>
            </div>
        </>
    )
}

export default StatesTab
