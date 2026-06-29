import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Tabs, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    closeSessionInspectorAtom,
    sessionInspectorOpenAtom,
    sessionInspectorSessionIdAtom,
} from "./store"
import InteractionsTab from "./tabs/InteractionsTab"
import MountsTab from "./tabs/MountsTab"
import StatesTab from "./tabs/StatesTab"
import StreamsTab from "./tabs/StreamsTab"
import TranscriptsTab from "./tabs/TranscriptsTab"

const {Text} = Typography

const SessionInspectorDrawer = () => {
    const open = useAtomValue(sessionInspectorOpenAtom)
    const sessionId = useAtomValue(sessionInspectorSessionIdAtom)
    const close = useSetAtom(closeSessionInspectorAtom)

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
                    defaultActiveKey="streams"
                    items={[
                        {
                            key: "streams",
                            label: "Streams",
                            children: <StreamsTab sessionId={sessionId} />,
                        },
                        {
                            key: "transcripts",
                            label: "Transcripts",
                            children: <TranscriptsTab sessionId={sessionId} />,
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
