import {channelDebugEnabledAtom} from "@agenta/shared/state"
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
