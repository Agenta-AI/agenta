/** The one-time "you can also ask the agent" hint after a MANUAL automation create. */
import {composerPrefillSignalAtom} from "@agenta/shared/state"
import {claimOnceHint} from "@agenta/shared/utils"
import {notification} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {getDefaultStore} from "jotai"

import type {AutomationKind} from "./automationModel"

/** One key per action type: the hint teaches "automations can be asked for", once. */
const HINT_KEY = "automation-created-manually"

/** What the user would type next time — concrete, built from what they just created. */
export const buildAskAgentAutomationPrompt = ({
    name,
    kind,
    cron,
}: {
    name: string
    kind: AutomationKind
    cron: string
}): string => {
    const what = name.trim() ? `an automation like "${name.trim()}"` : "an automation"
    return kind === "schedule"
        ? `Set up ${what} on the schedule ${cron}, and ask me anything you need to configure it.`
        : `Set up ${what} that reacts to an app event, and ask me anything you need to configure it.`
}

/**
 * Fires AFTER a successful manual create, once per browser. Non-blocking on purpose
 * (a notification, not a dialog): the user just finished a task, so the hint must not
 * stand between them and the result. Inside the playground a composer is mounted, so
 * the hint carries an "Ask the agent" action that PREFILLS (never sends) the example
 * prompt; elsewhere it is text only.
 */
export const maybeShowAskAgentAutomationHint = ({
    name,
    kind,
    cron,
    inPlayground,
}: {
    name: string
    kind: AutomationKind
    cron: string
    inPlayground: boolean
}) => {
    if (!claimOnceHint(HINT_KEY)) return

    const prompt = buildAskAgentAutomationPrompt({name, kind, cron})
    const key = "ask-agent-automation-hint"
    notification.open({
        key,
        message: "Next time, just ask the agent",
        description: `You can create or change automations from chat — for example: “${prompt}”`,
        duration: 12,
        btn: inPlayground ? (
            <Button
                size="sm"
                onClick={() => {
                    getDefaultStore().set(composerPrefillSignalAtom, {
                        text: prompt,
                        at: Date.now(),
                    })
                    notification.destroy(key)
                }}
            >
                Ask the agent
            </Button>
        ) : undefined,
    })
}
