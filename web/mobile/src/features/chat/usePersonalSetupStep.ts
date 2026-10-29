import {useEffect, useMemo, useState} from "react"

import {agentRequirementsAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {personalSetupItems, type PersonalSetupItem} from "@agenta/entity-ui/onboarding"
import {useAtomValue} from "jotai"

/**
 * The chat's "Connect your accounts" card: the viewer's own missing items of the agent the chat
 * runs, from the Needs setup answer the screen already reads (the same query as the model setup
 * strip, so no request is added).
 *
 * The rows are taken once per session, from the first answer that has any, so a row the viewer
 * fixes stays on the card marked done instead of jumping away. The card never holds a message:
 * it is optional, and closing it ("Continue" or ✕) only puts it away for this session.
 */
export interface PersonalSetupStep {
    open: boolean
    workflowId: string
    items: PersonalSetupItem[]
    /** The keys Needs setup lists now; a row whose key is gone is done. */
    pendingKeys: ReadonlySet<string>
    close: () => void
}

export const usePersonalSetupStep = (sessionId: string, revisionId: string): PersonalSetupStep => {
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId))
    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId)) ?? ""
    const current = useMemo(() => personalSetupItems(requirements), [requirements])
    const [latched, setLatched] = useState<PersonalSetupItem[]>([])
    const [closed, setClosed] = useState(false)

    useEffect(() => {
        setLatched([])
        setClosed(false)
    }, [sessionId])

    useEffect(() => {
        if (latched.length === 0 && current.length > 0) setLatched(current)
    }, [current, latched.length])

    const pendingKeys = useMemo(() => new Set(current.map((item) => item.key)), [current])
    return {
        open: !closed && latched.length > 0 && Boolean(workflowId),
        workflowId,
        items: latched,
        pendingKeys,
        close: () => setClosed(true),
    }
}
