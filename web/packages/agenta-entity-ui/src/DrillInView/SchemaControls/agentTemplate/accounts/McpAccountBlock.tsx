/** The "Owner" part of an MCP server view (F03 f6, f7): Personal or Project sign-in, and "Your sign-in". */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"
import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"
import mcpAccountCatalog from "@agenta/i18n/catalogs/entityUi.mcpAccount"
import {ChoiceSwitch} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {Warning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AccountLine, AccountLineAction} from "../../../../accounts/AccountLine"
import {McpSignIn} from "../../../../accounts/McpSignIn"
import {useOwnerWord} from "../../../../accounts/OwnerField"
import {useItemWorkflowId, type ItemAccountContext} from "../../../../accounts/useItemAccount"

import {mcpAccountOptions} from "./accountOptions"
import {EmptyAccountBox} from "./EmptyAccountBox"
import {FieldHeading} from "./FieldHeading"
import {useRunsWithoutPerson} from "./useRunsWithoutPerson"

export interface McpAccountBlockProps {
    endpoint: MCPEndpoint | undefined
    source: AccountSource
    onChange: (source: AccountSource) => void
    /** The agent the view shows, for the warning about runs without a person. */
    context: ItemAccountContext
    disabled?: boolean
}

export function McpAccountBlock({
    endpoint,
    source,
    onChange,
    context,
    disabled,
}: McpAccountBlockProps) {
    const t = useT(mcpAccountCatalog, accountsCatalog)
    const ownerWord = useOwnerWord()
    const access = useAtomValue(personalAccountsAccessAtom)
    const name = endpoint?.name || endpoint?.slug || ""
    const eachPerson = source === USER_ACCOUNT_SOURCE
    // Personal needs a server that takes a sign-in and personal accounts on, or a saved Personal.
    const offerPersonal =
        Boolean(endpoint) &&
        mcpAccountOptions({
            source,
            personalAccounts: access === "on",
            authMode: endpoint?.auth_mode,
        }).length > 1
    // A server that takes no sign-in has no account to name (canvas F03 f6).
    if (!eachPerson && endpoint?.auth_mode === "none") return null

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <FieldHeading
                    label={t("entityUi.accounts.owner")}
                    note={t("entityUi.mcpAccount.chooseWhose", {name})}
                />
                <ChoiceSwitch
                    value={source}
                    choices={[
                        {
                            value: USER_ACCOUNT_SOURCE,
                            label: ownerWord("user"),
                            note: t("entityUi.mcpAccount.eachPersonsOwnNote", {name}),
                            disabled: !offerPersonal,
                        },
                        {
                            value: "agent",
                            label: ownerWord("project"),
                            note: t("entityUi.mcpAccount.oneSharedNote"),
                        },
                    ]}
                    onChange={onChange}
                    aria-label={t("entityUi.accounts.owner")}
                    disabled={disabled}
                />
                {eachPerson ? <NoPersonWarning context={context} /> : null}
            </div>

            {/* No sign-in for a viewer who may not edit, or who can hold no own sign-in. */}
            {eachPerson && !disabled && endpoint && endpoint.user_sign_in !== undefined ? (
                <div className="flex flex-col gap-2">
                    <FieldHeading
                        label={t("entityUi.mcpAccount.yourSignIn")}
                        note={t("entityUi.mcpAccount.yourSignInNote", {name})}
                    />
                    <YourSignInLine endpoint={endpoint} name={name} />
                </div>
            ) : null}
        </div>
    )
}

/**
 * The viewer's own sign-in: "Your sign-in: {name}" (or "Signed in" when the server gave no name)
 * with "Sign out", or "Not signed in yet" / expired with "Sign in to {server}".
 */
export function YourSignInLine({endpoint, name}: {endpoint: MCPEndpoint; name: string}) {
    const t = useT(mcpAccountCatalog, accountsCatalog)
    const {pendingId, signOut} = usePersonalMcpSignIn()
    const own = endpoint.user_sign_in

    if (own?.is_ready) {
        return (
            <AccountLine
                text={
                    own.account_name
                        ? t("entityUi.mcpAccount.signedInAs", {account: own.account_name})
                        : t("entityUi.mcpAccount.signedIn")
                }
            >
                <AccountLineAction
                    disabled={pendingId === endpoint.id}
                    onClick={() => void signOut(endpoint)}
                >
                    {t("entityUi.accounts.signOut")}
                </AccountLineAction>
            </AccountLine>
        )
    }

    return (
        <div className="flex flex-col gap-1.5">
            <McpSignIn
                endpoint={endpoint}
                tokenLabel={t("entityUi.accounts.tokenPlaceholder")}
                tokenPlaceholder={t("entityUi.accounts.tokenPlaceholder")}
                submitLabel={t("entityUi.accounts.saveToken")}
            >
                {(start, pending) => (
                    <EmptyAccountBox
                        text={
                            own
                                ? t("entityUi.accounts.signInExpired")
                                : t("entityUi.mcpAccount.notSignedInYet")
                        }
                    >
                        {start ? (
                            <Button
                                size="compact"
                                variant="outline"
                                disabled={pending}
                                onClick={start}
                            >
                                {t("entityUi.mcpAccount.signInTo", {name})}
                            </Button>
                        ) : null}
                    </EmptyAccountBox>
                )}
            </McpSignIn>
        </div>
    )
}

/** Shown when the agent has runs without a person: a channel, or an automation saved by an API key. */
function NoPersonWarning({context}: {context: ItemAccountContext}) {
    const t = useT(mcpAccountCatalog)
    if (!useRunsWithoutPerson(useItemWorkflowId(context))) return null
    return (
        <div className="flex items-start gap-2 rounded-lg border border-solid border-warning/30 bg-warning/10 px-3 py-2 text-meta leading-4 text-foreground">
            <Warning size={14} className="mt-px shrink-0 text-warning" />
            <span>{t("entityUi.mcpAccount.noPersonWarning")}</span>
        </div>
    )
}
