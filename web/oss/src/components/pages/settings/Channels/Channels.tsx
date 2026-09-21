import {channelDebugEnabledAtom} from "@agenta/shared/state"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import ConnectionsSection from "./components/ConnectionsSection"
import InboxEventsSection from "./components/InboxEventsSection"
import OutboxEventsSection from "./components/OutboxEventsSection"
import SpacesSection from "./components/SpacesSection"
import ThreadsSection from "./components/ThreadsSection"

export default function Channels() {
    const debugEnabled = useAtomValue(channelDebugEnabledAtom)

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary" className="text-xs">
                    The chat platforms this project is connected to. Connect an agent to Slack or
                    Telegram from the agent's own page.
                </Typography.Text>
            </div>
            <ConnectionsSection />
            {/*
             * Behind the "Channel debug" preference: spaces are not functional yet, and threads,
             * inbox events and outbox events are logs, not settings.
             */}
            {debugEnabled ? (
                <>
                    <SpacesSection />
                    <ThreadsSection />
                    <InboxEventsSection />
                    <OutboxEventsSection />
                </>
            ) : null}
        </div>
    )
}
