import {useEffect, useRef, useState} from "react"

import {Segmented, Tabs, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import {type AgentChatTrack, DEFAULT_TRACK} from "./assets/constants"
import AgentChatConversation from "./components/AgentChatConversation"
import SessionTabLabel from "./components/SessionTabLabel"
import {
    activeSessionIdAtom,
    addSessionAtom,
    closeSessionAtom,
    renameSessionAtom,
    sessionLabel,
    sessionMessagesAtom,
    sessionsListAtom,
    setActiveSessionAtom,
} from "./state/sessions"

const {Text, Title} = Typography

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

    const sessions = useAtomValue(sessionsListAtom)
    const rawActiveId = useAtomValue(activeSessionIdAtom)
    const allMessages = useAtomValue(sessionMessagesAtom)
    const addSession = useSetAtom(addSessionAtom)
    const closeSession = useSetAtom(closeSessionAtom)
    const renameSession = useSetAtom(renameSessionAtom)
    const setActiveSession = useSetAtom(setActiveSessionAtom)

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
                <Title level={4} className="!mb-0">
                    Agent chat (contract v1)
                </Title>
                <Text type="secondary" className="!text-xs">
                    Parallel agent conversations — add a tab for each.
                </Text>
            </div>

            <Tabs
                type="editable-card"
                size="small"
                className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-tabpane]:h-full"
                activeKey={activeId}
                onChange={setActiveSession}
                onEdit={(targetKey, action) => {
                    if (action === "add") addSession()
                    else if (typeof targetKey === "string") closeSession(targetKey)
                }}
                tabBarExtraContent={{
                    right: (
                        <Tooltip
                            title={
                                track === "agenta"
                                    ? "Dev: Track B — FE adapts to Agenta {role, content} + tool_approvals"
                                    : "Dev: Track A — useChat posts UIMessage[] parts verbatim"
                            }
                        >
                            <Segmented<AgentChatTrack>
                                size="small"
                                value={track}
                                onChange={setTrack}
                                options={[
                                    {label: "A", value: "uimessage"},
                                    {label: "B", value: "agenta"},
                                ]}
                            />
                        </Tooltip>
                    ),
                }}
                items={sessions.map((session, index) => ({
                    key: session.id,
                    closable: sessions.length > 1,
                    label: (
                        <SessionTabLabel
                            label={sessionLabel(session, allMessages[session.id], index)}
                            onRename={(title) => renameSession({id: session.id, title})}
                        />
                    ),
                    children: (
                        <AgentChatConversation
                            // `:${track}` → dev track flip remounts with a fresh transport,
                            // rehydrating messages from the persisted store.
                            key={`${session.id}:${track}`}
                            sessionId={session.id}
                            track={track}
                            appId={appId}
                        />
                    ),
                }))}
            />
        </div>
    )
}

export default AgentChatSlice
