import {useState} from "react"

import {deriveStreamNest} from "@agenta/entities/session"
import {message} from "@agenta/ui/app-message"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Button, Popconfirm, Skeleton, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {isSessionStreamingAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import {projectIdAtom} from "@/oss/state/project"

import {attachStream, detachStream, fetchStream, killStream} from "../api"
import {
    closeSessionInspectorAtom,
    sessionInspectorWatcherIdAtom,
    setSessionInspectorWatcherIdAtom,
} from "../store"

const NestBadge = ({on, label}: {on: boolean; label: string}) => (
    <Tag color={on ? "green" : "default"} className="m-0">
        {label}
    </Tag>
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

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load stream" showIcon />

    const nest = deriveStreamNest(data)

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
                <NestBadge on={nest.isAlive} label="alive" />
                <NestBadge on={nest.isRunning} label="running" />
                <NestBadge on={nest.isAttached || localStreaming} label="attached" />
                {nest.resumable ? (
                    <Tag color="blue" className="m-0">
                        resumable
                    </Tag>
                ) : null}
                {nest.reattachable ? (
                    <Tag color="gold" className="m-0">
                        reattachable
                    </Tag>
                ) : null}
            </div>

            {/* Wrapping key/value (long UUIDs must break, never widen the panel). */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-colorTextTertiary">stream_id</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-colorTextSecondary">
                    {data?.id ?? "—"}
                </dd>
                <dt className="text-colorTextTertiary">turn_id</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-colorTextSecondary">
                    {data?.turn_id ?? "—"}
                </dd>
                <dt className="text-colorTextTertiary">status</dt>
                <dd className="m-0 min-w-0 break-all text-colorTextSecondary">
                    {data?.status?.code ?? "—"}
                </dd>
                <dt className="text-colorTextTertiary">watcher_id</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-colorTextSecondary">
                    {watcherId ?? "—"}
                </dd>
            </dl>

            <div className="flex flex-wrap gap-2">
                <Button
                    onClick={onAttach}
                    loading={busy}
                    disabled={!nest.isRunning || localStreaming || Boolean(watcherId)}
                >
                    Attach
                </Button>
                <Button onClick={onDetach} loading={busy} disabled={!watcherId && !localStreaming}>
                    Detach
                </Button>
                <Popconfirm
                    title="Kill this session?"
                    onConfirm={onKill}
                    okButtonProps={{danger: true}}
                >
                    <Button danger loading={busy}>
                        Kill
                    </Button>
                </Popconfirm>
            </div>
        </div>
    )
}

export default StreamsTab
