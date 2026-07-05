import {useState} from "react"

import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {message} from "@agenta/ui/app-message"
import {WarningCircle} from "@phosphor-icons/react"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Descriptions, Popconfirm, Space, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {isSessionStreamingAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import {projectIdAtom} from "@/oss/state/project"

import {attachStream, detachStream, fetchStream, killStream} from "../api"
import {deriveNest} from "../nest"
import {
    closeSessionInspectorAtom,
    sessionInspectorWatcherIdAtom,
    setSessionInspectorWatcherIdAtom,
} from "../store"

const NestBadge = ({on, label}: {on: boolean; label: string}) => (
    <Tag color={on ? "green" : "default"}>{label}</Tag>
)

const StreamsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const watcherId = useAtomValue(sessionInspectorWatcherIdAtom)
    // This browser tab is itself streaming the session — it IS the live connection, even though
    // an inline chat run never calls the coordination-plane attach. Treat it as attached.
    const localStreaming = useAtomValue(isSessionStreamingAtomFamily(sessionId))
    const setWatcherId = useSetAtom(setSessionInspectorWatcherIdAtom)
    const closeInspector = useSetAtom(closeSessionInspectorAtom)
    const queryClient = useQueryClient()
    const [busy, setBusy] = useState(false)

    const queryKey = ["session-inspector", "stream", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchStream(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    const refresh = () => queryClient.invalidateQueries({queryKey})

    const onAttach = async () => {
        setBusy(true)
        try {
            const res = await attachStream(sessionId, projectId)
            setWatcherId(res.watcher_id ?? null)
            message.success("Attached")
            await refresh()
        } catch {
            message.error("Attach failed")
        } finally {
            setBusy(false)
        }
    }

    const onDetach = async () => {
        // The local chat tab IS the connection but never held a coordination-plane watcher_id;
        // detaching it is the chat's job (stop/cancel), not the inspector's, so guide instead.
        if (!watcherId) {
            if (localStreaming) {
                message.info(
                    "This tab is the live connection — stop the run from the chat to detach",
                )
            }
            return
        }
        setBusy(true)
        try {
            await detachStream(sessionId, watcherId, projectId)
            setWatcherId(null)
            message.success("Detached")
            await refresh()
        } catch {
            message.error("Detach failed")
        } finally {
            setBusy(false)
        }
    }

    const onKill = async () => {
        setBusy(true)
        try {
            await killStream(sessionId, projectId)
            message.success("Session killed")
            closeInspector()
        } catch {
            message.error("Kill failed")
        } finally {
            setBusy(false)
        }
    }

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
                <AlertTitle>Failed to load stream</AlertTitle>
            </Alert>
        )

    const nest = deriveNest(data?.flags)

    return (
        <Space direction="vertical" size="middle" className="w-full">
            <Space wrap>
                <NestBadge on={nest.isAlive} label="alive" />
                <NestBadge on={nest.isRunning} label="running" />
                <NestBadge on={nest.isAttached || localStreaming} label="attached" />
            </Space>

            <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="stream_id">
                    <span className="font-mono text-xs">{data?.id ?? "—"}</span>
                </Descriptions.Item>
                <Descriptions.Item label="turn_id">
                    <span className="font-mono text-xs">{data?.turn_id ?? "—"}</span>
                </Descriptions.Item>
                <Descriptions.Item label="status">{data?.status?.code ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="watcher_id (this client)">
                    <span className="font-mono text-xs">{watcherId ?? "—"}</span>
                </Descriptions.Item>
            </Descriptions>

            <Space wrap>
                <Button
                    onClick={onAttach}
                    disabled={!nest.isRunning || localStreaming || Boolean(watcherId) || busy}
                    variant="outline"
                >
                    {busy ? <Spinner /> : null}
                    Attach
                </Button>
                <Button
                    onClick={onDetach}
                    disabled={(!watcherId && !localStreaming) || busy}
                    variant="outline"
                >
                    {busy ? <Spinner /> : null}
                    Detach
                </Button>
                <Popconfirm
                    title="Kill this session?"
                    onConfirm={onKill}
                    okButtonProps={{danger: true}}
                >
                    <Button variant="destructive" disabled={busy}>
                        {busy ? <Spinner /> : null}
                        Kill
                    </Button>
                </Popconfirm>
                <Button onClick={refresh} variant="ghost" disabled={busy}>
                    {busy ? <Spinner /> : null}
                    Refresh
                </Button>
            </Space>
        </Space>
    )
}

export default StreamsTab
