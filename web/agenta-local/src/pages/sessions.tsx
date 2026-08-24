import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {useEffect} from "react"

import {Conversation} from "@/features/sessions/Conversation"
import {SessionList} from "@/features/sessions/SessionList"
import {ConversationEmpty} from "@/features/sessions/states/ConversationEmpty"
import {selectedSessionIdAtom} from "@/lib/state/sessions"

export default function SessionsPage() {
    const router = useRouter()
    const sessionId =
        typeof router.query.session_id === "string" ? router.query.session_id : undefined
    const setSelectedId = useSetAtom(selectedSessionIdAtom)

    useEffect(() => setSelectedId(sessionId ?? null), [sessionId, setSelectedId])

    const select = (id: string) =>
        void router.push({pathname: "/sessions", query: {session_id: id}})
    const back = () => void router.push({pathname: "/sessions"})

    return (
        <section className="split-page sessions-page">
            <aside className={sessionId ? "entity-pane mobile-hidden" : "entity-pane"}>
                <SessionList selectedId={sessionId} select={select} />
            </aside>
            <div className={sessionId ? "detail-pane" : "detail-pane mobile-hidden"}>
                {sessionId ? (
                    <Conversation sessionId={sessionId} back={back} />
                ) : (
                    <ConversationEmpty />
                )}
            </div>
        </section>
    )
}
