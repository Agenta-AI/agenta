/** Store or clear the viewer's account choice for one "user" item of one agent, then read again. */
import {useState} from "react"

import {
    deleteAccountChoice,
    invalidatePersonalAccountReads,
    queryAccountChoices,
    upsertAccountChoice,
    type AccountPick,
} from "@agenta/entities/accountChoice"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

export const useAccountChoice = (workflowId: string, itemKey: string) => {
    const projectId = useAtomValue(projectIdAtom)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    /** Runs one write; true when it worked, false when it failed, null when nothing was sent. */
    const run = async (write: (projectId: string) => Promise<unknown>): Promise<boolean | null> => {
        if (!projectId || !workflowId || busy) return null
        setBusy(true)
        setFailed(false)
        try {
            await write(projectId)
            await invalidatePersonalAccountReads()
            return true
        } catch {
            setFailed(true)
            return false
        } finally {
            setBusy(false)
        }
    }
    /** Store `account` as the viewer's choice for this item of this agent. */
    const choose = (account: AccountPick) =>
        run((projectId) => upsertAccountChoice({projectId, workflowId, itemKey, account}))
    /** Remove the viewer's choice, so runs follow their default account again. */
    const clear = () =>
        run(async (projectId) => {
            const choices = await queryAccountChoices({projectId, filter: {workflowId, itemKey}})
            for (const choice of choices)
                await deleteAccountChoice({projectId, accountChoiceId: choice.id})
        })
    return {choose, clear, busy, failed}
}
