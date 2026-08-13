import {Typography} from "antd"

import AgentRosterSection from "./components/AgentRosterSection"
import ConnectionsSection from "./components/ConnectionsSection"
import InboxEventsSection from "./components/InboxEventsSection"
import OutboxEventsSection from "./components/OutboxEventsSection"
import SlackOwnAppSection from "./components/SlackOwnAppSection"
import SpacesSection from "./components/SpacesSection"
import ThreadsSection from "./components/ThreadsSection"

export default function Channels() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <Typography.Text type="secondary" className="text-xs">
                    Wire up agents to answer in chat platforms — who may answer, where, and under
                    what policy. Every policy control shows which level decided it.
                </Typography.Text>
            </div>
            <ConnectionsSection />
            <SlackOwnAppSection />
            <AgentRosterSection />
            <SpacesSection />
            <ThreadsSection />
            <InboxEventsSection />
            <OutboxEventsSection />
        </div>
    )
}
