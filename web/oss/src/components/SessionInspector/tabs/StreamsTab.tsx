import {useState} from "react"

import {message} from "@agenta/ui/app-message"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Button, Descriptions, Popconfirm, Skeleton, Space, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

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
        if (!watcherId) return
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

    const nest = deriveNest(data?.flags)

    return (
        <Space direction="vertical" size="middle" className="w-full">
            <Space wrap>
                <NestBadge on={nest.isAlive} label="alive" />
                <NestBadge on={nest.isRunning} label="running" />
                <NestBadge on={nest.isAttached} label="attached" />
                {nest.resumable ? <Tag color="blue">resumable</Tag> : null}
                {nest.reattachable ? <Tag color="orange">reattachable</Tag> : null}
            </Space>

            <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="stream_id">{data?.id ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="turn_id">{data?.turn_id ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="status">{data?.status?.code ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="watcher_id (this client)">
                    {watcherId ?? "—"}
                </Descriptions.Item>
            </Descriptions>

            <Space wrap>
                <Button onClick={onAttach} loading={busy} disabled={!nest.isRunning}>
                    Attach
                </Button>
                <Button onClick={onDetach} loading={busy} disabled={!watcherId}>
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
                <Button type="text" onClick={refresh} loading={busy}>
                    Refresh
                </Button>
            </Space>
        </Space>
    )
}

export default StreamsTab
