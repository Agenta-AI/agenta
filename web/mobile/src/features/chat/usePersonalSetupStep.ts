import {useEffect, useMemo, useState} from "react"

import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {agentRequirementsAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {personalSetupItems, type PersonalSetupItem} from "@agenta/entity-ui/onboarding"
import {useAtomValue} from "jotai"

export interface PersonalSetupStep {
    open: boolean
    workflowId: string
    items: PersonalSetupItem[]
    /** The keys the last Needs setup answer lists; a row whose key is gone is done. */
    pendingKeys: ReadonlySet<string>
    close: () => void
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The chat's "Connect your accounts" card: the viewer's own missing items of the agent the chat
 * runs, from the Needs setup answer the screen already reads (the same query as the needs-setup
 * banner, so no request is added).
 *
 * The rows are taken once per session, from the first answer that has any, so a row the viewer
 * fixes stays on the card marked done instead of jumping away. A row turns done only when an
 * answer leaves it out: while Needs setup is loading or failed, the last answer stands. The card
 * never holds a message: it is optional, and closing it ("Continue" or ✕) only puts it away for
 * this session. With personal accounts off for the deployment the run leaves the viewer's own
 * items out and nothing can be connected, so the card stays hidden.
 */
export const usePersonalSetupStep = (sessionId: string, revisionId: string): PersonalSetupStep => {
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId))
    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId)) ?? ""
    const access = useAtomValue(personalAccountsAccessAtom)
    const [latched, setLatched] = useState<PersonalSetupItem[]>([])
    const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(NONE)
    const [closed, setClosed] = useState(false)

    useEffect(() => {
        setLatched([])
        setPendingKeys(NONE)
        setClosed(false)
    }, [sessionId])

    // `null` is "not answered", not "nothing missing", so it keeps the last answer.
    const current = useMemo(
        () => (requirements ? personalSetupItems(requirements) : null),
        [requirements],
    )
    useEffect(() => {
        if (!current) return
        setPendingKeys(new Set(current.map((item) => item.key)))
        setLatched((rows) => (rows.length === 0 && current.length > 0 ? current : rows))
    }, [current])

    return {
        open: !closed && access === "on" && latched.length > 0 && Boolean(workflowId),
        workflowId,
        items: latched,
        pendingKeys,
        close: () => setClosed(true),
    }
}
