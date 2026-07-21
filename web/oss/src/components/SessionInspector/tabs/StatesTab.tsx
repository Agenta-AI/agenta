import {useEffect} from "react"

import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {sessionStatusAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import {projectIdAtom} from "@/oss/state/project"

import {fetchState} from "../api"

const {Text} = Typography

const StatesTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    // Durable state (state_id / sandbox_id) is written mid-run, so revalidate on run transitions
    // and poll while streaming — otherwise a brand-new session shows "no durable state" forever.
    const runStatus = useAtomValue(sessionStatusAtomFamily(sessionId))
    const queryClient = useQueryClient()

    const queryKey = ["session-inspector", "state", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchState(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
        refetchOnMount: "always",
        refetchInterval: runStatus === "running" ? 2500 : false,
    })

    useEffect(() => {
        void queryClient.invalidateQueries({queryKey})
    }, [runStatus, sessionId, projectId])

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load state" showIcon />
    if (!data) return <Text type="secondary">No durable state for this session yet.</Text>

    return (
        <div className="flex flex-col gap-2">
            {/* Wrapping key/value (long UUIDs must break, never widen the panel). */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-colorTextTertiary">state_id</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-colorTextSecondary">
                    {data.id ?? "—"}
                </dd>
                <dt className="text-colorTextTertiary">sandbox_id</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-colorTextSecondary">
                    {data.sandbox_id ?? "—"}
                </dd>
                <dt className="text-colorTextTertiary">updated_at</dt>
                <dd className="m-0 min-w-0 break-all text-colorTextSecondary">
                    {data.updated_at ?? "—"}
                </dd>
            </dl>
            <div>
                <div className="mb-1 text-[10px] font-medium text-colorTextTertiary">data</div>
                <pre className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded bg-colorFillQuaternary p-2 text-xs text-colorTextSecondary">
                    {JSON.stringify(data.data ?? {}, null, 2)}
                </pre>
            </div>
        </div>
    )
}

export default StatesTab
