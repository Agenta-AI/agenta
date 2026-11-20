import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {UIMessage} from "ai"
import {useRouter} from "next/router"

import {builderChatHref} from "../builder/builderChatHref"

import {
    activateBuilderTab,
    agentTab,
    applyAddressTab,
    builderTabHref,
    builderTabKey,
    closeBuilderTab,
    followBuilderResult,
    followBuilderResults,
    openBuilderTab,
    parseTabParam,
    readBuilderTabs,
    writeBuilderTabs,
    type BuilderTab,
    type BuilderTabsState,
} from "./builderTabs"
import {agentResults, latestContextAgent, type AgentRef} from "./paneAgent"

/**
 * The builder tabs of the chat on screen: kept per chat in this browser, the active one in the
 * address (`?tab=<kind>:<id>`). A chat with no stored tab opens one for the agent of its latest
 * builder result, else the agent of its page context, else the agent the browser linked it to.
 * Later saved results open their agent's tab with a dot (design D15).
 *
 * The address and the state have one writer each way: a link with a tab is applied to the state,
 * and every change of the active tab made here writes the address (with a replace). Before the
 * address names this chat, only the first send writes it.
 */
export const useBuilderTabs = ({
    sessionId,
    routeChatId,
    tab,
    linkedAgentId,
    workspaceId,
    projectId,
}: {
    sessionId: string
    routeChatId: string | null
    tab: string | undefined
    linkedAgentId: string | null
    workspaceId: string
    projectId: string
}) => {
    const router = useRouter()
    const [held, setHeld] = useState(() => ({sessionId, state: readBuilderTabs(sessionId)}))
    const state = useMemo(
        () => (held.sessionId === sessionId ? held.state : readBuilderTabs(sessionId)),
        [held, sessionId],
    )
    // The latest state, also between a change and the render that shows it.
    const latest = useRef(state)
    latest.current = state

    const tabRef = parseTabParam(tab)
    const addressKey = tabRef ? builderTabKey(tabRef) : null
    const onThisChat = routeChatId === sessionId
    const address = useRef({addressKey, onThisChat})
    address.current = {addressKey, onThisChat}

    const writeAddress = useCallback(
        (key: string | null) =>
            void router.replace(
                builderTabHref(builderChatHref({workspaceId, projectId, sessionId}), key),
                undefined,
                {shallow: true},
            ),
        [projectId, router, sessionId, workspaceId],
    )

    /** Changes the state; when the active tab moves on this chat's address, the address follows. */
    const commit = useCallback(
        (change: (state: BuilderTabsState) => BuilderTabsState) => {
            const base = latest.current
            const next = change(base)
            if (next !== base) {
                latest.current = next
                writeBuilderTabs(sessionId, next)
                setHeld({sessionId, state: next})
            }
            const {addressKey: shown, onThisChat: routed} = address.current
            if (routed && next.active !== shown) writeAddress(next.active)
            return next
        },
        [sessionId, writeAddress],
    )

    // A link with a tab opens or brings forward that tab. A chat address with no tab shows the
    // stored active tab.
    useEffect(() => {
        if (!onThisChat) return
        if (tabRef) commit((current) => applyAddressTab(current, tabRef))
        else if (latest.current.active) writeAddress(latest.current.active)
        // tabRef is rebuilt every render; its key is the dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressKey, onThisChat, sessionId])

    const onMessagesChanged = useCallback(
        (messages: UIMessage[]) =>
            commit((current) =>
                followBuilderResults(
                    current,
                    agentResults(messages),
                    latestContextAgent(messages) ??
                        (linkedAgentId ? {id: linkedAgentId, name: ""} : null),
                ),
            ),
        [commit, linkedAgentId],
    )

    /** The first message of a new chat: its chip's agent opens a tab; the address names the chat. */
    const onFirstSend = useCallback(
        (agent: AgentRef | null) => {
            const next = commit((current) =>
                agent ? followBuilderResult(current, agentTab(agent)) : current,
            )
            writeAddress(next.active)
        },
        [commit, writeAddress],
    )

    return {
        state,
        open: useCallback(
            (next: BuilderTab) => commit((current) => openBuilderTab(current, next)),
            [commit],
        ),
        activate: useCallback(
            (key: string) => commit((current) => activateBuilderTab(current, key)),
            [commit],
        ),
        close: useCallback(
            (key: string) => commit((current) => closeBuilderTab(current, key)),
            [commit],
        ),
        onMessagesChanged,
        onFirstSend,
    }
}
