import {useCallback, useEffect, useState} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {agentTemplateByKey} from "@agenta/entities/workflow"
import {useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {useAtomValue} from "jotai"

import {pendingTasksAtom} from "../home/pendingTask"

/**
 * The connect step, run INSIDE the session rather than before the agent exists (#6043).
 *
 * Every create hands off the same way — entity, then session, then the first turn — so this is
 * the one place a template's accounts can be asked for without giving any entry its own surface.
 * The template key rides on the stashed task because nothing else here can name it: the agent's
 * config is written by the builder during this very turn.
 *
 * `useAgentSetupStep.open` is the whole decision and it is reused verbatim. It declines when the
 * template asks for nothing, when every required account is already connected, and when no slot
 * offers a choice of provider — so a project that is already set up never sees a card.
 */

/**
 * How long the held first message waits for the connections query before going anyway.
 *
 * Same rule as the vault wait in `pendingTaskPolicy`: wait for the thing you need, never without
 * end. A hold while the card is UP is the feature working and is not bounded — the user can see
 * what is being asked. A hold on a query that never answers is invisible, so it gets a deadline.
 */
export const SETUP_CONNECTIONS_WAIT_LIMIT_MS = 10_000

export interface SessionSetupStep {
    /** The card is up, or the decision to show it has not been made yet. */
    blocking: boolean
    accounts: ReturnType<typeof useAgentSetupStep>["accounts"]
    suggestions: ReturnType<typeof useAgentSetupStep>["suggestions"]
    addAccount: ReturnType<typeof useAgentSetupStep>["addAccount"]
    /** The card is showing and should be rendered. */
    open: boolean
    /** Done with the step — the held first message goes. */
    resolve: () => void
}

export const useSessionSetupStep = (sessionId: string): SessionSetupStep => {
    const task = useAtomValue(pendingTasksAtom)[sessionId]
    const {isLoading: connectionsLoading} = useToolConnectionsQuery()
    const step = useAgentSetupStep()

    const templateKey = task?.templateKey
    const seedMessage = task?.text ?? ""

    // Whether this session's open-or-skip decision has been made. State, not a ref: the held
    // message is released by a re-render, so a ref would hold it until something else moved.
    const [decided, setDecided] = useState(false)
    const [waitedOut, setWaitedOut] = useState(false)
    useEffect(() => {
        setDecided(false)
        setWaitedOut(false)
    }, [sessionId])

    // The bounded half of the wait. Armed only while a template create is actually waiting on the
    // query, so an ordinary session never sets a timer.
    useEffect(() => {
        if (decided || !templateKey || !connectionsLoading) return
        const timer = setTimeout(() => setWaitedOut(true), SETUP_CONNECTIONS_WAIT_LIMIT_MS)
        return () => clearTimeout(timer)
    }, [decided, templateKey, connectionsLoading])

    const {open: openStep} = step
    useEffect(() => {
        if (decided) return
        // No template means nothing to ask: decide immediately so the message is never held.
        if (!templateKey) {
            setDecided(true)
            return
        }
        if (connectionsLoading && !waitedOut) return
        const template = agentTemplateByKey(templateKey)
        // A key that names no template is not a reason to hold a message.
        if (template) openStep({seedMessage, name: template.name, template})
        setDecided(true)
    }, [decided, templateKey, seedMessage, connectionsLoading, waitedOut, openStep])

    const {close} = step
    const resolve = useCallback(() => close(), [close])

    const open = step.draft !== null
    return {
        blocking: !decided || open,
        accounts: step.accounts,
        suggestions: step.suggestions,
        addAccount: step.addAccount,
        open,
        resolve,
    }
}
