import {browserLiveStatusQueryAtomFamily, browserPaneOpenAtomFamily} from "@agenta/entities/browser"
import {BrowserAskCard} from "@agenta/entity-ui/browser"
import {isBrowserEnabled} from "@agenta/shared/api"
import {useAtom, useAtomValue} from "jotai"

import {ContentRail} from "@/components/ContentRail"

import {useBrowserStatusPoll} from "./useBrowserStatusPoll"

/** The agent waits for the person in its browser; shown until they open the browser pane. */
export const BrowserAskDock = ({sessionId, working}: {sessionId: string; working: boolean}) => {
    useBrowserStatusPoll(sessionId, working, isBrowserEnabled())
    const status = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId)).data
    const [paneOpen, setPaneOpen] = useAtom(browserPaneOpenAtomFamily(sessionId))
    if (!isBrowserEnabled() || !status?.running || !status.waitReason || paneOpen) return null
    return (
        <div className="bg-background shrink-0 px-3 pt-3 pb-0">
            <ContentRail>
                <BrowserAskCard
                    reason={status.waitReason}
                    url={status.url}
                    onOpen={() => setPaneOpen(true)}
                />
            </ContentRail>
        </div>
    )
}
