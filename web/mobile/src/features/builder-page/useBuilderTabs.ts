import {useCallback, useEffect, useRef, useState} from "react"

import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"
import type {UIMessage} from "ai"
import {useAtomValue, useStore} from "jotai"
import {useRouter} from "next/router"

import {builderChatHref} from "../builder/builderChatHref"

import {
    activateBuilderTab,
    agentTab,
    applyAddressTab,
    builderTabHref,
    builderTabKey,
    clearChangedSection,
    closeBuilderTab,
    followBuilderResult,
    followBuilderResults,
    openBuilderTab,
    parseTabParam,
    builderTabsAtomFamily,
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
    const store = useStore()
    const tabsAtom = builderTabsAtomFamily(sessionId)
    const state = useAtomValue(tabsAtom)

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
            const base = store.get(tabsAtom)
            const next = change(base)
            if (next !== base) store.set(tabsAtom, next)
            const {addressKey: shown, onThisChat: routed} = address.current
            if (routed && next.active !== shown) writeAddress(next.active)
            return next
        },
        [store, tabsAtom, writeAddress],
    )

    // A link with a tab opens or brings forward that tab. A chat address with no tab shows the
    // stored active tab.
    useEffect(() => {
        if (!onThisChat) return
        if (tabRef) commit((current) => applyAddressTab(current, tabRef))
        else if (store.get(tabsAtom).active) writeAddress(store.get(tabsAtom).active)
        // tabRef is rebuilt every render; its key is the dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressKey, onThisChat, sessionId])

    // The latest builder save of the active tab's agent in this visit (task 41.1): the pane
    // follows it. Saves already in the chat when it loads are history, not followed.
    const [activeSave, setActiveSave] = useState<{
        toolCallId: string
        revisionId: string | null
    } | null>(null)
    // The tool calls in the first messages of this chat in this visit: history, never followed.
    const history = useRef<{sessionId: string; ids: Set<string>} | null>(null)

    const onMessagesChanged = useCallback(
        (messages: UIMessage[]) => {
            // No message yet (a new chat, or history still loading): nothing names an agent.
            if (!messages.length) return
            const before = store.get(tabsAtom)
            const results = agentResults(messages)
            const next = commit((current) =>
                followBuilderResults(
                    current,
                    results,
                    latestContextAgent(messages) ??
                        (linkedAgentId ? {id: linkedAgentId, name: ""} : null),
                ),
            )
            if (history.current?.sessionId !== sessionId) {
                history.current = {
                    sessionId,
                    ids: new Set(results.map((result) => result.toolCallId)),
                }
                return
            }
            if (!next.active) return
            const seen = history.current.ids
            const saved = results.filter(
                (result) =>
                    result.saved &&
                    !seen.has(result.toolCallId) &&
                    !before.followedToolCallIds.includes(result.toolCallId) &&
                    builderTabKey(agentTab(result.agent)) === next.active,
            )
            const last = saved.at(-1)
            if (last) setActiveSave({toolCallId: last.toolCallId, revisionId: last.revisionId})
        },
        [commit, linkedAgentId, sessionId],
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
        /** The tool call of the builder's latest save of the active tab's agent, in this visit. */
        activeSaveToolCallId: activeSave?.toolCallId ?? null,
        /** The revision that save made, when its result names one. */
        activeSaveRevisionId: activeSave?.revisionId ?? null,
        open: useCallback(
            (next: BuilderTab) => commit((current) => openBuilderTab(current, next)),
            [commit],
        ),
        activate: useCallback(
            (key: string) => commit((current) => activateBuilderTab(current, key)),
            [commit],
        ),
        clearChangedSection: useCallback(
            (key: string, section: MarkableSectionKey) =>
                commit((current) => clearChangedSection(current, key, section)),
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
