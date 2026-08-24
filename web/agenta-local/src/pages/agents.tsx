import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {useEffect} from "react"

import {AgentEditor} from "@/features/agents/AgentEditor"
import {AgentList} from "@/features/agents/AgentList"
import {selectedAgentIdAtom} from "@/lib/state/agents"

export default function AgentsPage() {
    const router = useRouter()
    const agentId = typeof router.query.agent_id === "string" ? router.query.agent_id : undefined
    const setSelectedId = useSetAtom(selectedAgentIdAtom)

    useEffect(() => setSelectedId(agentId ?? null), [agentId, setSelectedId])

    const select = (id?: string) => {
        void router.push(id ? {pathname: "/agents", query: {agent_id: id}} : {pathname: "/agents"})
    }

    return (
        <section className="split-page">
            <aside className={agentId ? "entity-pane mobile-hidden" : "entity-pane"}>
                <AgentList selectedId={agentId} select={select} />
            </aside>
            <div className={agentId ? "detail-pane" : "detail-pane mobile-create"}>
                <AgentEditor agentId={agentId} onCreated={select} onDeleted={() => select()} />
            </div>
        </section>
    )
}
