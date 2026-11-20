import {useCallback, useMemo, useRef, useState} from "react"

import type {Automation} from "@agenta/automation-ui"
import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {createT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"

import {useStartTaskSession} from "../chat/useStartTaskSession"

import {runNowText} from "./runNowText"

const tNow = createT(automationsScreensCatalog)

/** The words for each reason a run cannot start. */
export const TEST_RUN_BLOCKED_TEXT = {
    agent: "automations.screens.blockedAgent",
    instruction: "automations.screens.blockedInstruction",
    dirty: "automations.screens.blockedDirty",
} as const

export type TestRunBlockedReason = keyof typeof TEST_RUN_BLOCKED_TEXT

/** Why "Run now" cannot start, or null when it can. */
export const testRunBlockedReason = ({
    agentId,
    instruction,
    dirty = false,
}: {
    agentId: string | null
    instruction: string
    dirty?: boolean
}): TestRunBlockedReason | null => {
    if (!agentId) return "agent"
    // The run IS the instruction; with none there is nothing to send.
    if (!instruction) return "instruction"
    if (dirty) return "dirty"
    return null
}

/**
 * "Run now" for every entry point of this app (the detail button, the list row menu, the empty
 * run history, the panel's run history view): a NEW session with the bound agent, the
 * automation's message sent as its first turn, and the screen moves to it. No delivery is
 * written, so the run does not show in the run history.
 *
 * One hook so every entry point refuses for the same reasons. `run` shows the reason as a toast
 * when it is blocked (a menu item has no disabled-with-tooltip state); a button reads `blocked`
 * and disables itself instead. A second call while one is in flight does nothing.
 */
export const useAutomationRunNow = (
    automation: Automation | null,
    base: string,
    {dirty = false}: {dirty?: boolean} = {},
) => {
    const startTask = useStartTaskSession(base)
    const [starting, setStarting] = useState(false)
    const inFlight = useRef(false)

    // Shape-agnostic: the message is read straight off the stored inputs, so no agent schema has
    // to resolve before "Run now" can be pressed.
    const instruction = useMemo(
        () => getScheduleMessagePreview(automation?.raw.data?.inputs_fields).trim(),
        [automation?.raw.data?.inputs_fields],
    )
    const blocked = automation
        ? testRunBlockedReason({agentId: automation.agentId, instruction, dirty})
        : "agent"
    const blockedText = blocked ? tNow(TEST_RUN_BLOCKED_TEXT[blocked]) : undefined

    const run = useCallback(async () => {
        if (!automation || inFlight.current) return
        if (blocked !== null || !automation.agentId) {
            if (blocked !== null) message.error(tNow(TEST_RUN_BLOCKED_TEXT[blocked]))
            return
        }
        inFlight.current = true
        setStarting(true)
        try {
            const text = await runNowText(automation)
            // Null: the deliveries call failed. Empty: the pills resolved to nothing. Either way
            // there is no message, so no session opens.
            if (text) void startTask(automation.agentId, text)
        } finally {
            inFlight.current = false
            setStarting(false)
        }
    }, [automation, blocked, startTask])

    return {blocked, blockedText, starting, run}
}
