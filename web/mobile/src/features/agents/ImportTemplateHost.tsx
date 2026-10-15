import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {ImportTemplateDialog, type CreatedAgent} from "@agenta/home-ui"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {agentHandoffPath} from "./agentHandoff"
import {importTemplateRequestAtom} from "./importTemplateRequest"

/** Mounts the template import dialog and sends a created agent to its first session. */
export const ImportTemplateHost = ({base}: {base: string}) => {
    const router = useRouter()
    const [request, setRequest] = useAtom(importTemplateRequestAtom)
    if (!request) return null

    const close = () => setRequest((current) => (current ? {...current, open: false} : current))
    const handOff = async (agent: CreatedAgent) => {
        // Closed first: the atom outlives this screen, and the next AppShell must not reopen it.
        close()
        // The load already started this session on the server; open it.
        const sessionId = agent.sessionId ?? newId()
        await router
            .push(agentHandoffPath({base, appId: agent.appId, sessionId}))
            .catch(() => false)
        void invalidateWorkflowsListCache()
    }

    return (
        <ImportTemplateDialog
            key={request.id}
            open={request.open}
            start={request.start}
            onClose={close}
            onCreated={(agent) => void handOff(agent)}
        />
    )
}
