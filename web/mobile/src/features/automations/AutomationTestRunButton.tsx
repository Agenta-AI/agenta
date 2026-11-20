import type {Automation} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {Button} from "@agenta/ui/ui"
import {Play} from "@phosphor-icons/react"

import {useAutomationRunNow} from "./useAutomationRunNow"

/**
 * Run this automation now, without waiting for its trigger.
 *
 * It opens a NEW session with the bound agent and sends the automation's instruction as the
 * first turn — the same hand-off Home's composer uses, so the run is under way by the time the
 * chat is on screen. A test run is a run: the reader came to see what the automation does, not
 * to be handed its text to send.
 *
 * Not the shared `RunSubscriptionButton`: that publishes to `simulatedAgentRunAtomFamily`, which
 * only the desktop playground reads, so on this surface it would silently do nothing.
 *
 * Disabled with a reason rather than hidden — "why can't I test this" is a question the control
 * itself should answer.
 */
export const AutomationTestRunButton = ({
    automation,
    base,
    dirty,
}: {
    automation: Automation
    /** `/w/:workspace/p/:project` */
    base: string
    /** Unsaved config edits — a test run would exercise a version that does not exist yet. */
    dirty: boolean
}) => {
    const t = useT(automationsScreensCatalog)
    const {blocked, blockedText, starting, run} = useAutomationRunNow(automation, base, {dirty})

    return (
        // A disabled button takes no pointer events, so the reason has to hang off something that
        // does.
        <span title={blockedText}>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-xs font-normal"
                disabled={blocked !== null || starting}
                title={blockedText ?? t("automations.screens.runNowTitle")}
                onClick={() => void run()}
            >
                <Play aria-hidden className="size-3" />
                {t("automations.screens.runNow")}
            </Button>
        </span>
    )
}
