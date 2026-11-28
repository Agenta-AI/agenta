import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {IconTile} from "@agenta/ui/composed"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {
    ArrowClockwiseIcon,
    ChatCircleDots,
    ClockCounterClockwise,
    WarningIcon,
} from "@phosphor-icons/react"

/**
 * Designed states for the run history and the session pane beside it.
 *
 * The list skeleton mirrors the real list — a day heading over borderless rows, at the same
 * 9/10 padding — so nothing shifts when the deliveries query lands. The pane's states are
 * separate from the list's because "no runs yet" and "this run has no conversation" are
 * different sentences with different fixes.
 */

export const AutomationRunListSkeleton = ({
    groups = 2,
    rows = 3,
}: {
    groups?: number
    rows?: number
}) => (
    <div aria-hidden>
        {Array.from({length: groups}, (_, group) => (
            <div key={group} className="mb-1">
                <div className="px-2.5 pb-1 pt-3">
                    <div className="flex h-4 items-center">
                        <SkeletonBlock active className="h-2.5 w-20" />
                    </div>
                </div>
                {Array.from({length: rows}, (_, row) => (
                    <div key={row} className="flex items-center gap-2 px-2.5 py-2">
                        <SkeletonBlock active className="size-2 shrink-0 rounded-round" />
                        <SkeletonBlock active className="h-3.5 flex-1" />
                        <SkeletonBlock active className="h-3 w-10 shrink-0" />
                    </div>
                ))}
            </div>
        ))}
    </div>
)

/** The panel's run history while its view loads: the heading, the count line, then the list. */
export const AutomationRunHistoryPanelSkeleton = () => {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            className="flex min-h-0 w-full flex-1 flex-col pb-6 pl-1.5 pr-4 pt-3"
        >
            <div className="flex items-center gap-2 pl-2.5">
                <div className="flex h-5.5 flex-1 items-center">
                    <SkeletonBlock active className="h-4 w-28" />
                </div>
                <span className="p-1">
                    <SkeletonBlock active className="size-3.75" />
                </span>
            </div>
            <div className="mb-2.5 mt-1 flex h-4.5 items-center pl-2.5">
                <SkeletonBlock active className="h-3 w-24" />
            </div>
            <AutomationRunListSkeleton />
        </div>
    )
}

/**
 * Never run.
 *
 * Not an error and not a defect: a paused automation, or one whose schedule has not come round
 * yet, is in a perfectly good state — so this says what will happen rather than what is missing.
 */
export const AutomationRunHistoryEmpty = ({
    filtered = false,
    action,
}: {
    filtered?: boolean
    /** One action under the text, for example "Run now". */
    action?: ReactNode
}) => {
    const t = useT(automationsEditorCatalog)
    return (
        // Centred in the column it fills, not stacked under the heading: the list's own height is
        // the space this speaks for, and a message pinned to the top of an empty page reads as a
        // row that failed to render.
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-14 text-center">
            <IconTile size={40}>
                <ClockCounterClockwise aria-hidden className="text-muted-foreground" />
            </IconTile>
            {/* An automation that has never run and one whose runs are hidden behind a filter are
            different facts, and telling a reader "no runs yet" while a filter is on sends them
            looking for a fault in the automation. */}
            <p className="m-0 text-body font-medium text-foreground">
                {filtered ? t("automations.editor.noRunsFiltered") : t("automations.editor.noRuns")}
            </p>
            <p className="m-0 max-w-[38ch] text-label leading-snug text-muted-foreground">
                {filtered
                    ? t("automations.editor.noRunsFilteredBody")
                    : t("automations.editor.noRunsBody")}
            </p>
            {action ? <div className="mt-1">{action}</div> : null}
        </div>
    )
}

export const AutomationRunHistoryError = ({
    message,
    onRetry,
}: {
    message?: string
    onRetry?: () => void
    /** Unused: the kit sizes "Try again" on a phone. */
    phone?: boolean
}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-14 text-center">
            <WarningIcon className="size-6 text-destructive" />
            <p className="m-0 text-body font-medium text-foreground">
                {message ?? t("automations.editor.loadRunsFailed")}
            </p>
            {onRetry ? (
                <Button variant="outline" size="sm" className="text-label" onClick={onRetry}>
                    <ArrowClockwiseIcon className="size-3" />
                    {t("automations.editor.tryAgain")}
                </Button>
            ) : null}
        </div>
    )
}

/**
 * A run with no conversation to read.
 *
 * Three ordinary cases land here (see `runSessionId`): a test capture that never invoked, a
 * delivery rejected before it reached the agent, and a row written before the dispatcher
 * stamped a session. All three are finished runs, not loading ones — so this is a statement,
 * never a spinner.
 */
export const AutomationRunNoConversation = ({reason}: {reason?: string | null}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
            <IconTile size={40}>
                <ChatCircleDots aria-hidden className="text-muted-foreground" />
            </IconTile>
            <p className="m-0 text-body font-medium text-foreground">
                {t("automations.editor.noConversation")}
            </p>
            <p className="m-0 max-w-[40ch] text-label leading-snug text-muted-foreground">
                {t("automations.editor.noConversationBody")}
            </p>
            {reason ? (
                <p className="m-0 max-w-[52ch] break-words rounded-md border border-solid border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-label leading-snug text-muted-foreground">
                    {reason}
                </p>
            ) : null}
        </div>
    )
}

/**
 * The run has a session, but the agent behind it cannot be resolved.
 *
 * An automation whose agent was archived or unbound still has runs, and those runs still
 * happened — so this reports the missing agent rather than claiming the run produced nothing.
 */
export const AutomationRunConversationUnavailable = () => {
    const t = useT(automationsEditorCatalog)
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
            <WarningIcon className="size-5 text-muted-foreground" />
            <p className="m-0 text-body font-medium text-foreground">
                {t("automations.editor.conversationUnavailable")}
            </p>
            <p className="m-0 max-w-[42ch] text-label leading-snug text-muted-foreground">
                {t("automations.editor.conversationUnavailableBody")}
            </p>
        </div>
    )
}
