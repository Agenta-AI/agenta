import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import type {DisclosedConnection, ShareDisclosure} from "@agenta/entities/sharing"
import {useAtomValue} from "jotai"

import {shareDisclosureCopy as copy} from "./copy"
import {disclosureAccountNames, disclosurePersonalAccountNames} from "./result"

/** Who the change shares with. The UI ignores `trace_readers_can_read` on purpose. */
export type ShareDisclosureTarget =
    | {kind: "session-people"; names: readonly string[]}
    | {kind: "session-project"; projectName: string}
    | {kind: "agent"; agentName: string; projectName: string}

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

/** The text of the one-sentence confirm before any widening change. */
export const useShareDisclosureText = (
    target: ShareDisclosureTarget,
    disclosure: ShareDisclosure | null | undefined,
    /** The provider display name of a connection; never a slug. */
    providerLabel?: (connection: DisclosedConnection) => string,
) => {
    const accounts = disclosureAccountNames(disclosure, providerLabel)
    // With personal accounts off for the deployment, the run leaves these items out.
    const personalOff = useAtomValue(personalAccountsAccessAtom) === "off"
    const personalAccounts = personalOff
        ? []
        : disclosurePersonalAccountNames(disclosure, providerLabel).map(copy.personalAccount)
    const isAgent = target.kind === "agent"
    return {
        title: titleOf(target),
        body: bodyOf(target, accounts),
        personalAccounts,
        cancelLabel: isAgent ? copy.cancel : copy.back,
        confirmLabel: isAgent ? copy.shareWithProject : copy.share,
    }
}
