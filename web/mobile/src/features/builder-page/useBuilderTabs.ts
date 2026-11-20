import {useCallback, useEffect, useMemo, useState} from "react"

import type {UIMessage} from "ai"
import {useRouter} from "next/router"

import {builderChatHref} from "../builder/builderChatHref"

import {
    activateBuilderTab,
    applyAddressTab,
    builderTabKey,
    closeBuilderTab,
    followBuilderResult,
    markFollowed,
    openBuilderTab,
    readBuilderTabs,
    writeBuilderTabs,
    type BuilderTab,
    type BuilderTabsState,
} from "./builderTabs"
import {agentResults, latestContextAgent, parseTabParam, type AgentRef} from "./paneAgent"

const agentTab = (agent: AgentRef): BuilderTab => ({kind: "agent", id: agent.id, name: agent.name})

/** The address of a builder chat with its active tab, or with none. */
const chatHref = (
    workspaceId: string,
    projectId: string,
    sessionId: string,
    key: string | null,
) => {
    const path = builderChatHref({workspaceId, projectId, sessionId})
    return key ? `${path}?tab=${encodeURIComponent(key)}` : path
}

/**
 * The builder tabs of the chat on screen: kept per chat in this browser, the active one in the
 * address (`?tab=<kind>:<id>`, written with a replace). A chat with no stored tab opens one for
 * the agent of its latest builder result, else the agent of its page context, else the agent the
 * browser linked it to. Later builder results open their agent's tab with a dot (design D15).
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
    const update = useCallback(
        (change: (state: BuilderTabsState) => BuilderTabsState) =>
            setHeld((prev) => {
                const base = prev.sessionId === sessionId ? prev.state : readBuilderTabs(sessionId)
                const next = change(base)
                if (next !== base) writeBuilderTabs(sessionId, next)
                return next === prev.state && prev.sessionId === sessionId
                    ? prev
                    : {sessionId, state: next}
            }),
        [sessionId],
    )

    // A link with a tab opens or brings forward that tab, once the address names this chat.
    const tabRef = parseTabParam(tab)
    const addressKey = tabRef ? builderTabKey(tabRef) : null
    const onThisChat = routeChatId === sessionId
    useEffect(() => {
        if (!onThisChat || !tabRef) return
        update((current) => applyAddressTab(current, tabRef))
        // tabRef is rebuilt every render; its key is the dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressKey, onThisChat, update])

    // The address follows the active tab. Before the address names this chat, the first send
    // writes it (one writer at a time).
    useEffect(() => {
        if (!onThisChat || state.active === addressKey) return
        if (!state.active && addressKey) return
        void router.replace(chatHref(workspaceId, projectId, sessionId, state.active), undefined, {
            shallow: true,
        })
    }, [addressKey, onThisChat, projectId, router, sessionId, state.active, workspaceId])

    // A chat with nothing stored and no tab in the address starts on the agent the browser
    // linked it to; its messages may name a better one below.
    useEffect(() => {
        if (!linkedAgentId || addressKey) return
        update((current) =>
            current.tabs.length || current.closed.length || current.followed.length
                ? current
                : followBuilderResult(current, {kind: "agent", id: linkedAgentId, name: ""}),
        )
    }, [addressKey, linkedAgentId, update])

    const onMessagesChanged = useCallback(
        (messages: UIMessage[]) => {
            const results = agentResults(messages)
            update((current) => {
                // A chat with no tab yet: one tab for the agent of the latest result, else of the
                // page context; every result so far counts as followed.
                if (!current.tabs.length && !current.closed.length && !current.followed.length) {
                    const latest = results.at(-1)?.agent ?? latestContextAgent(messages)
                    const fresh = latest ? followBuilderResult(current, agentTab(latest)) : current
                    return markFollowed(
                        fresh,
                        results.map((result) => result.toolCallId),
                    )
                }
                let next = current
                for (const result of results) {
                    if (next.followed.includes(result.toolCallId)) continue
                    next = markFollowed(next, [result.toolCallId])
                    // A result with no change, a refusal or a denied call changes no tab.
                    if (result.saved) next = followBuilderResult(next, agentTab(result.agent))
                }
                return next
            })
        },
        [update],
    )

    /** The first message of a new chat: the agent of its chip opens a tab, and the address moves. */
    const onFirstSend = useCallback(
        (agent: AgentRef | null) => {
            let active: string | null = null
            update((current) => {
                const next = agent ? followBuilderResult(current, agentTab(agent)) : current
                active = next.active
                return next
            })
            void router.replace(
                chatHref(
                    workspaceId,
                    projectId,
                    sessionId,
                    active ?? (agent ? `agent:${agent.id}` : null),
                ),
                undefined,
                {shallow: true},
            )
        },
        [projectId, router, sessionId, update, workspaceId],
    )

    return {
        state,
        open: useCallback(
            (next: BuilderTab) => update((current) => openBuilderTab(current, next)),
            [update],
        ),
        activate: useCallback(
            (key: string) => update((current) => activateBuilderTab(current, key)),
            [update],
        ),
        close: useCallback(
            (key: string) => update((current) => closeBuilderTab(current, key)),
            [update],
        ),
        onMessagesChanged,
        onFirstSend,
    }
}
