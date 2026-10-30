/**
 * The "Account" block of an MCP server's permission drawer (contract section 12, spec 5.1).
 *
 * The select writes the item's account source: each person's own sign-in to the project's server
 * (`"user"`, the slug stays) or the project's sign-in. With "each person", the line says whether
 * the viewer is signed in, and signs them in or out. The state is the server row's own
 * `user_sign_in`, which the server list already carries, so the line costs no request.
 */
import type {AccountSource} from "@agenta/entities/accountChoice"
import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useAtomValue} from "jotai"

import {AccountLine, AccountLineAction} from "../../../../accounts/AccountLine"
import {ACCOUNT_COPY} from "../../../../accounts/copy"
import {McpSignIn} from "../../../../accounts/McpSignIn"

import {AccountBlock} from "./AccountBlock"
import {mcpAccountOptions} from "./accountOptions"

export function McpAccountBlock({
    endpoint,
    source,
    onChange,
    disabled,
}: {
    endpoint: MCPEndpoint | undefined
    source: AccountSource
    onChange: (source: AccountSource) => void
    disabled?: boolean
}) {
    const access = useAtomValue(personalAccountsAccessAtom)
    const options = mcpAccountOptions({
        source,
        personalAccounts: access === "on",
        authMode: endpoint?.auth_mode,
    })
    return (
        <AccountBlock
            value={source}
            options={options}
            onChange={(value) => onChange(value as AccountSource)}
            disabled={disabled}
            line={
                source === "user" && endpoint && endpoint.user_sign_in !== undefined ? (
                    <YourSignInLine endpoint={endpoint} />
                ) : null
            }
        />
    )
}

/** "When you run it: signed in as you · Sign out", or a way to sign in. */
export function YourSignInLine({endpoint}: {endpoint: MCPEndpoint}) {
    const {pendingId, signOut} = usePersonalMcpSignIn()
    const own = endpoint.user_sign_in

    if (own?.is_ready) {
        return (
            <AccountLine text={ACCOUNT_COPY.signedInAsYou}>
                <AccountLineAction
                    disabled={pendingId === endpoint.id}
                    onClick={() => void signOut(endpoint)}
                >
                    {ACCOUNT_COPY.signOut}
                </AccountLineAction>
            </AccountLine>
        )
    }

    return (
        <div className="flex flex-col gap-1.5">
            <McpSignIn
                endpoint={endpoint}
                tokenLabel={ACCOUNT_COPY.tokenPlaceholder}
                tokenPlaceholder={ACCOUNT_COPY.tokenPlaceholder}
                submitLabel={ACCOUNT_COPY.saveToken}
            >
                {(start, pending) => (
                    <AccountLine text={own ? ACCOUNT_COPY.signInExpired : ACCOUNT_COPY.notSignedIn}>
                        {start ? (
                            <AccountLineAction disabled={pending} onClick={start}>
                                {ACCOUNT_COPY.signIn}
                            </AccountLineAction>
                        ) : null}
                    </AccountLine>
                )}
            </McpSignIn>
        </div>
    )
}
