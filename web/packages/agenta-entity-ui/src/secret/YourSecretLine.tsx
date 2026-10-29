/**
 * "When you run it: <your secret> · Change", for a variable that takes each person's own secret.
 *
 * Reads the viewer's own account for the item from `resolve` and lists their own secrets; picking
 * one stores an account choice for this agent and variable. It shows only the viewer's own
 * secret, never another person's.
 */
import {useMemo, useState} from "react"

import {
    invalidateAccountChoices,
    upsertAccountChoice,
    userItemKey,
} from "@agenta/entities/accountChoice"
import {CustomSecretFormat, personalNamedSecretsAtom} from "@agenta/entities/secret"
import type {AgentSecretBinding} from "@agenta/entities/secret"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    AccountLine,
    AccountLineAction,
} from "../DrillInView/SchemaControls/agentTemplate/accounts/AccountBlock"
import {ACCOUNT_COPY} from "../DrillInView/SchemaControls/agentTemplate/accounts/copy"
import {useItemAccount} from "../DrillInView/SchemaControls/agentTemplate/accounts/useItemAccount"

export function YourSecretLine({
    revisionId,
    bindings,
    envVar,
    container,
    zIndex,
}: {
    revisionId: string
    /** The agent's attachments, as saved: the item reader needs only the "user" ones. */
    bindings: AgentSecretBinding[]
    envVar: string
    container?: HTMLElement | null
    zIndex?: number
}) {
    const context = useMemo(
        () => ({revisionId, agent: {sandbox: {credentials: bindings}}}),
        [bindings, revisionId],
    )
    const itemKey = userItemKey("secret", envVar)
    const {workflowId, account, loading, failed} = useItemAccount(context, itemKey)
    const projectId = useAtomValue(projectIdAtom)
    const secrets = useAtomValue(personalNamedSecretsAtom)
    const [failure, setFailure] = useState(false)
    const textSecrets = useMemo(
        () => secrets.filter((secret) => secret.format === CustomSecretFormat.Text && secret.id),
        [secrets],
    )

    if (loading || failed) return null

    const usedId = account?.match ? account.secret_id : null
    const used = textSecrets.find((secret) => secret.id === usedId)
    if (textSecrets.length === 0 && !account?.match) {
        return <AccountLine text={ACCOUNT_COPY.noSecretYet} />
    }

    const choose = async (secretId: string) => {
        if (!projectId || !workflowId || secretId === usedId) return
        setFailure(false)
        try {
            await upsertAccountChoice({projectId, workflowId, itemKey, account: {secretId}})
            await Promise.all([invalidateAccountChoices(), invalidateAgentRequirements()])
        } catch {
            setFailure(true)
        }
    }

    return (
        <div className="flex flex-col gap-1">
            <AccountLine
                text={
                    account?.match
                        ? ACCOUNT_COPY.whenYouRun(account.name ?? used?.name ?? "")
                        : ACCOUNT_COPY.noneChosen
                }
            >
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <AccountLineAction>
                            {account?.match ? ACCOUNT_COPY.change : ACCOUNT_COPY.choose}
                        </AccountLineAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        container={container}
                        style={zIndex ? {zIndex} : undefined}
                        className="min-w-[200px]"
                    >
                        {textSecrets.map((secret) => (
                            <DropdownMenuItem
                                key={secret.id}
                                onSelect={() => void choose(secret.id as string)}
                            >
                                <span className="flex size-3.5 shrink-0 items-center">
                                    {secret.id === usedId ? <Check size={14} /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{secret.name}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </AccountLine>
            {failure ? (
                <span className="text-xs text-error">{ACCOUNT_COPY.choiceFailed}</span>
            ) : null}
        </div>
    )
}
