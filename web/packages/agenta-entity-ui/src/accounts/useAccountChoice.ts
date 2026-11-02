/**
 * Store the viewer's account for one "user" item of one agent, then read again what each agent
 * gets and what Needs setup asks for. The one write behind the drawers, "Attach a secret" and the
 * setup card. A second pick while one is saving is ignored.
 */
import {useState} from "react"

import {
    invalidatePersonalAccountReads,
    upsertAccountChoice,
    type AccountPick,
} from "@agenta/entities/accountChoice"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

export const useAccountChoice = (workflowId: string, itemKey: string) => {
    const projectId = useAtomValue(projectIdAtom)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    /** True when the choice is stored, false when the write failed, null when nothing was sent. */
    const choose = async (account: AccountPick): Promise<boolean | null> => {
        if (!projectId || !workflowId || busy) return null
        setBusy(true)
        setFailed(false)
        try {
            await upsertAccountChoice({projectId, workflowId, itemKey, account})
            await invalidatePersonalAccountReads()
            return true
        } catch {
            setFailed(true)
            return false
        } finally {
            setBusy(false)
        }
    }
    return {choose, busy, failed}
}
