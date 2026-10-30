import type {DisclosedConnection, ShareDisclosure} from "@agenta/entities/sharing"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

import {shareDisclosureCopy as copy} from "./copy"
import {disclosureAccountNames, disclosurePersonalAccountNames} from "./result"

/** Who the change shares with. The UI ignores `trace_readers_can_read` on purpose. */
export type ShareDisclosureTarget =
    | {kind: "session-people"; names: readonly string[]}
    | {kind: "session-project"; projectName: string}
    | {kind: "agent"; agentName: string; projectName: string}

export interface ShareDisclosureNoticeProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    target: ShareDisclosureTarget
    disclosure: ShareDisclosure | null | undefined
    /** The provider display name of a connection; never a slug. */
    providerLabel?: (connection: DisclosedConnection) => string
    onConfirm: () => void
    confirming?: boolean
}

const titleOf = (target: ShareDisclosureTarget) => {
    if (target.kind === "session-people") return copy.titlePeople(target.names)
    if (target.kind === "session-project") return copy.titleProject(target.projectName)
    return copy.titleAgent(target.agentName)
}

const bodyOf = (target: ShareDisclosureTarget, accounts: readonly string[]) => {
    if (target.kind === "agent") {
        return accounts.length
            ? copy.bodyAgent(target.projectName, accounts)
            : copy.bodyAgentNoAccounts(target.projectName)
    }
    return accounts.length ? copy.bodySession(accounts) : copy.bodySessionNoAccounts
}

/** The one-sentence confirm before any widening change. */
export const ShareDisclosureNotice = ({
    open,
    onOpenChange,
    target,
    disclosure,
    providerLabel,
    onConfirm,
    confirming = false,
}: ShareDisclosureNoticeProps) => {
    const accounts = disclosureAccountNames(disclosure, providerLabel)
    const personalAccounts = disclosurePersonalAccountNames(disclosure, providerLabel)
    const isAgent = target.kind === "agent"
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{titleOf(target)}</AlertDialogTitle>
                    <AlertDialogDescription className="text-foreground">
                        {bodyOf(target, accounts)}
                    </AlertDialogDescription>
                    {personalAccounts.length ? (
                        <ul className="m-0 list-none p-0 text-sm text-muted-foreground">
                            {personalAccounts.map((account) => (
                                <li key={account}>{copy.personalAccount(account)}</li>
                            ))}
                        </ul>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={confirming}>
                        {isAgent ? copy.cancel : copy.back}
                    </AlertDialogCancel>
                    <LoadingButton loading={confirming} onClick={onConfirm}>
                        {isAgent ? copy.shareWithProject : copy.share}
                    </LoadingButton>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
