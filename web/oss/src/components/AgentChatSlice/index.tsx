import {useEffect, useRef, useState} from "react"

import {Tabs, TabsContent} from "@agenta/primitive-ui/components/tabs"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {Segmented} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {useRouter} from "next/router"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import {type AgentChatTrack, DEFAULT_TRACK} from "./assets/constants"
import {loadSessionMessages} from "./assets/loadSession"
import AgentChatConversation from "./components/AgentChatConversation"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import SessionTagBar from "./components/SessionTagBar"
import {useChatScopeKey} from "./state/scope"
import {
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    adoptSessionAtomFamily,
    closeSessionAtomFamily,
    renameSessionAtomFamily,
    sessionMessagesAtom,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
} from "./state/sessions"

/**
 * Agent chat streaming slice — contract v1.
 *
 * A real `useChat` conversation streaming the v6 UI Message Stream protocol from the RAG_QA
 * contract service. Proves the FE↔service streaming contract end to end: text + tool-call
 * lifecycle + one human approval + a trace link into the existing trace drawer.
 *
 * Multiple parallel conversations are exposed as top-level dynamic tabs (one `useChat`
 * session each; add with `+`, close with `×`, double-click a tab to rename). The session
 * list, active tab, and each conversation's messages persist to localStorage, so the tabs
 * survive a reload. antd keeps visited panes mounted, so switching tabs preserves a
 * session's live stream / approval state. Does NOT touch the Jotai/web-worker playground
 * pipeline — `useChat` owns these conversations.
 *
 * The Track A/B request-contract toggle (an internal experiment comparing how the request
 * body is shaped) is demoted to a dev-only control in the tab bar's extra slot; the response
 * stream + rendering are identical across tracks.
 */
const AgentChatSlice = () => {
    const [track, setTrack] = useState<AgentChatTrack>(DEFAULT_TRACK)
    const appId = useAtomValue(routerAppIdAtom)
    const store = useStore()
    const router = useRouter()

    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const adoptSession = useSetAtom(adoptSessionAtomFamily(scope))
    const closeSession = useSetAtom(closeSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))

    // Open-from-observability: a `?session=<id>` deep link (from a trace / session drawer)
    // opens that session as a tab. Hydrate its messages first — from localStorage if this
    // browser ran it, else from the server seam (`loadSessionMessages`, inert until a backend
    // SessionStore exists) — THEN adopt, so the conversation seeds with whatever we found. The
    // param is stripped afterwards so a reload / tab switch doesn't re-adopt.
    const sessionParam = router.query.session
    useEffect(() => {
        if (!router.isReady) return
        const id = Array.isArray(sessionParam) ? sessionParam[0] : sessionParam
        if (!id) return
        let cancelled = false
        const open = () => {
            if (!cancelled) adoptSession({id})
        }
        const existing = store.get(sessionMessagesAtom)[id]
        if (existing && existing.length) {
            open()
        } else {
            loadSessionMessages(id).then((msgs) => {
                if (cancelled) return
                if (msgs && msgs.length) {
                    store.set(sessionMessagesAtom, {
                        ...store.get(sessionMessagesAtom),
                        [id]: msgs,
                    })
                }
                open()
            })
        }
        const rest = {...router.query}
        delete rest.session
        router.replace({pathname: router.pathname, query: rest}, undefined, {shallow: true})
        return () => {
            cancelled = true
        }
    }, [router.isReady, sessionParam])

    // Always keep at least one tab. Re-arms when the list drains (e.g. switching to an app
    // with no sessions yet) without double-firing under StrictMode.
    const seeded = useRef(false)
    useEffect(() => {
        if (sessions.length === 0 && !seeded.current) {
            seeded.current = true
            addSession()
        }
        if (sessions.length > 0) seeded.current = false
    }, [sessions.length, addSession])

    // Tolerate a stale active id (its tab was closed) by falling back to the first tab.
    const activeId = sessions.some((s) => s.id === rawActiveId) ? rawActiveId : sessions[0]?.id

    return (
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4">
            <div>
                <h4 className="!mb-0 text-base font-semibold leading-snug">
                    Agent chat (contract v1)
                </h4>
                <span className="!text-xs text-muted-foreground">
                    Parallel agent conversations — add a tab for each.
                </span>
            </div>

            <Tabs
                value={activeId ?? null}
                onValueChange={(key) => {
                    if (key !== null) setActiveSession(String(key))
                }}
                className="flex min-h-0 flex-1 flex-col gap-0"
            >
                <SessionTagBar
                    sessions={sessions}
                    activeId={activeId}
                    onSelect={setActiveSession}
                    onAdd={addSession}
                    onClose={closeSession}
                    onRename={(id, title) => renameSession({id, title})}
                    extra={
                        <div className="flex items-center gap-2">
                            <SessionHistoryMenu />
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Segmented<AgentChatTrack>
                                            size="small"
                                            value={track}
                                            onChange={setTrack}
                                            options={[
                                                {label: "A", value: "uimessage"},
                                                {label: "B", value: "agenta"},
                                            ]}
                                        />
                                    }
                                />
                                <TooltipContent>
                                    {track === "agenta"
                                        ? "Dev: Track B - FE adapts to Agenta {role, content} + tool_approvals"
                                        : "Dev: Track A - useChat posts UIMessage[] parts verbatim"}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    }
                />
                {sessions.map((session) => (
                    <TabsContent
                        key={session.id}
                        value={session.id}
                        keepMounted
                        className="h-full min-h-0 flex-1"
                    >
                        <AgentChatConversation
                            // `:${track}` → dev track flip remounts with a fresh transport,
                            // rehydrating messages from the persisted store.
                            key={`${session.id}:${track}`}
                            sessionId={session.id}
                            track={track}
                            appId={appId}
                        />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}

export default AgentChatSlice
