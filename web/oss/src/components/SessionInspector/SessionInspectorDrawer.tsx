import {useState} from "react"

import {message} from "@agenta/ui/app-message"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowClockwise, DownloadSimple} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Tabs, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {dumpSessionTab, type SessionInspectorTab} from "./dump"
import {
    closeSessionInspectorAtom,
    sessionInspectorOpenAtom,
    sessionInspectorSessionIdAtom,
} from "./store"
import InteractionsTab from "./tabs/InteractionsTab"
import MountsTab from "./tabs/MountsTab"
import RecordsTab from "./tabs/RecordsTab"
import StatesTab from "./tabs/StatesTab"
import StreamsTab from "./tabs/StreamsTab"

const {Text} = Typography

// Tab key → the segment the tab's useQuery key uses (streams/states are singular there).
const QUERY_KEY_BY_TAB: Record<SessionInspectorTab, string> = {
    streams: "stream",
    records: "records",
    states: "state",
    mounts: "mounts",
    interactions: "interactions",
}

const SessionInspectorDrawer = () => {
    const open = useAtomValue(sessionInspectorOpenAtom)
    const sessionId = useAtomValue(sessionInspectorSessionIdAtom)
    const projectId = useAtomValue(projectIdAtom)
    const close = useSetAtom(closeSessionInspectorAtom)
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<SessionInspectorTab>("streams")
    const [dumping, setDumping] = useState(false)

    const onRefresh = () =>
        queryClient.invalidateQueries({
            queryKey: ["session-inspector", QUERY_KEY_BY_TAB[activeTab], projectId, sessionId],
        })

    const onDump = async () => {
        if (!sessionId) return
        setDumping(true)
        try {
            await dumpSessionTab(activeTab, sessionId, projectId)
        } catch {
            message.error("Dump failed")
        } finally {
            setDumping(false)
        }
    }

    return (
        <EnhancedDrawer
            open={open}
            onClose={() => close()}
            width={640}
            closeOnLayoutClick={false}
            title={
                <div className="flex flex-col">
                    <span>Session inspector</span>
                    <Text type="secondary" className="text-xs font-normal font-mono">
                        {sessionId ?? "—"}
                    </Text>
                </div>
            }
        >
            {sessionId ? (
                <Tabs
                    activeKey={activeTab}
                    onChange={(key) => setActiveTab(key as SessionInspectorTab)}
                    tabBarExtraContent={{
                        right: (
                            <>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ArrowClockwise size={14} />}
                                    onClick={onRefresh}
                                    aria-label={`Refresh ${activeTab}`}
                                    title="Refresh"
                                />
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<DownloadSimple size={14} />}
                                    loading={dumping}
                                    onClick={onDump}
                                    aria-label={`Download ${activeTab} as markdown`}
                                    title="Download as markdown"
                                />
                            </>
                        ),
                    }}
                    items={[
                        {
                            key: "streams",
                            label: "Streams",
                            children: <StreamsTab sessionId={sessionId} />,
                        },
                        {
                            key: "records",
                            label: "Records",
                            children: <RecordsTab sessionId={sessionId} />,
                        },
                        {
                            key: "states",
                            label: "States",
                            children: <StatesTab sessionId={sessionId} />,
                        },
                        {
                            key: "mounts",
                            label: "Mounts",
                            children: <MountsTab sessionId={sessionId} />,
                        },
                        {
                            key: "interactions",
                            label: "Interactions",
                            children: <InteractionsTab sessionId={sessionId} />,
                        },
                    ]}
                />
            ) : null}
        </EnhancedDrawer>
    )
}

export default SessionInspectorDrawer
