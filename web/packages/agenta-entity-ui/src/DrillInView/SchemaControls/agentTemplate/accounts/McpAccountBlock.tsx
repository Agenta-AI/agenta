/**
 * The "Account" part of an MCP server view (F03 f6, f7): whose sign-in the agent uses.
 *
 * The switch writes the item's account source: each person's own sign-in to the project's server
 * (`"user"`, the slug stays) or the project's sign-in. With "Each person's own", "Your sign-in"
 * says whether the viewer is signed in, with the account name when the server gave one, and signs
 * them in or out. The state is the server row's own `user_sign_in`, which the server list already
 * carries, so the part costs no request.
 */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"
import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"
import accountSwitchCatalog from "@agenta/i18n/catalogs/entityUi.accountSwitch"
import mcpAccountCatalog from "@agenta/i18n/catalogs/entityUi.mcpAccount"
import {Button} from "@agenta/ui/ui"
import {Warning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AccountLine, AccountLineAction} from "../../../../accounts/AccountLine"
import {AccountSwitch} from "../../../../accounts/AccountSwitch"
import {McpSignIn} from "../../../../accounts/McpSignIn"
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
    const t = useT(mcpAccountCatalog, accountSwitchCatalog, accountsCatalog)
    const access = useAtomValue(personalAccountsAccessAtom)
    const name = endpoint?.name || endpoint?.slug || ""
    const eachPerson = source === USER_ACCOUNT_SOURCE
    // Each person's own sign-in exists for a project server (the view resolves only those) that
    // takes a sign-in, with personal accounts on. A saved "each person's own" stays visible
    // when personal accounts are off.
    const showSwitch =
        Boolean(endpoint) &&
        mcpAccountOptions({
            source,
            personalAccounts: access === "on",
            authMode: endpoint?.auth_mode,
        }).length > 1

    return (
        <div className="flex flex-col gap-3.5">
            {showSwitch ? (
                <div className="flex flex-col gap-2">
                    <FieldHeading
                        label={t("entityUi.accounts.label")}
                        note={t("entityUi.mcpAccount.chooseWhose", {name})}
                    />
                    <AccountSwitch
                        value={source}
                        choices={[
                            {
                                value: USER_ACCOUNT_SOURCE,
                                label: t("entityUi.accountSwitch.eachPersonsOwn"),
                                note: t("entityUi.mcpAccount.eachPersonsOwnNote", {name}),
                            },
                            {
                                value: "agent",
                                label: t("entityUi.mcpAccount.oneShared"),
                                note: t("entityUi.mcpAccount.oneSharedNote"),
                            },
                        ]}
                        onChange={onChange}
                        aria-label={t("entityUi.accounts.label")}
                        disabled={disabled}
                    />
                    {eachPerson ? <NoPersonWarning context={context} /> : null}
                </div>
            ) : null}

            {eachPerson ? (
                // Disabled means the viewer may not edit the agent; those roles may not use the
                // project's MCP servers either, so a sign-in would lead nowhere. The API leaves
                // `user_sign_in` out when the viewer can hold no own sign-in at all.
                !disabled && endpoint && endpoint.user_sign_in !== undefined ? (
                    <div className="flex flex-col gap-2">
                        <FieldHeading
                            label={t("entityUi.mcpAccount.yourSignIn")}
                            note={t("entityUi.mcpAccount.yourSignInNote", {name})}
                        />
                        <YourSignInLine endpoint={endpoint} name={name} />
                    </div>
                ) : null
            ) : (
                <div className="flex flex-col gap-2">
                    <FieldHeading
                        label={t("entityUi.mcpAccount.sharedSignIn")}
                        note={t("entityUi.mcpAccount.sharedSignInNote")}
                    />
                    <span className="text-[13px] text-colorText">
                        {t("entityUi.accounts.projectSignIn")}
                    </span>
                </div>
            )}
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
                    // Canvas F03 f7: a dashed box with the dark sign-in button.
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
                                className="max-md:h-11"
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
        <div className="flex items-start gap-2 rounded-lg border border-solid border-colorWarningBorder bg-colorWarningBg px-3 py-2 text-xs leading-4 text-colorText">
            <Warning size={14} className="mt-px shrink-0 text-colorWarning" />
            <span>{t("entityUi.mcpAccount.noPersonWarning")}</span>
        </div>
    )
}
