import {ClockCounterClockwise} from "@phosphor-icons/react"

/**
 * Transcript-area notice for an EXISTING session whose durable history hydrated empty — the record
 * log was pruned (retention) or never persisted, so there's nothing to restore. Distinct from the
 * brand-new "start a chat" hero: it tells the user the earlier messages are gone while the composer
 * below still lets them continue the session. Deliberately soft ("no longer available", not
 * "deleted") since a rare old never-run session can land here too.
 */
const AgentChatHistoryUnavailable = () => (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2.5 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-colorFillTertiary text-colorTextTertiary">
            <ClockCounterClockwise size={22} />
        </span>
        <div className="text-sm font-medium text-colorText">History no longer available</div>
        <div className="text-xs leading-relaxed text-colorTextSecondary">
            This conversation&rsquo;s earlier messages aren&rsquo;t available here — they may have
            been cleared. Send a new message below to pick it back up.
        </div>
    </div>
)

export default AgentChatHistoryUnavailable
