/**
 * The "Account" block of an MCP server's permission drawer (contract section 12, spec 5.1).
 *
 * The select writes the item's account source: each person's own sign-in to the project's server
 * (`"user"`, the slug stays) or the project's sign-in. With "each person", the line says whether
 * the viewer is signed in, and signs them in or out. The state is the server row's own
 * `user_sign_in`, which the server list already carries, so the line costs no request.
 */
import {useState} from "react"

import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {Button, Input} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {AccountBlock, AccountLine, AccountLineAction} from "./AccountBlock"
import {mcpAccountOptions, type McpAccountSource} from "./accountOptions"
import {ACCOUNT_COPY} from "./copy"

export function McpAccountBlock({
    endpoint,
    source,
    onChange,
    disabled,
}: {
    endpoint: MCPEndpoint | undefined
    source: McpAccountSource
    onChange: (source: McpAccountSource) => void
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
            onChange={(value) => onChange(value as McpAccountSource)}
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
    const {pendingId, error, signIn, signInWithToken, signOut} = usePersonalMcpSignIn()
    const [token, setToken] = useState<string | null>(null)
    const pending = pendingId === endpoint.id
    const own = endpoint.user_sign_in

    if (own?.is_ready) {
        return (
            <AccountLine text={ACCOUNT_COPY.signedInAsYou}>
                <AccountLineAction disabled={pending} onClick={() => void signOut(endpoint)}>
                    {ACCOUNT_COPY.signOut}
                </AccountLineAction>
            </AccountLine>
        )
    }

    const tokenServer = endpoint.auth_mode === "api_key"
    return (
        <div className="flex flex-col gap-1.5">
            <AccountLine text={own ? ACCOUNT_COPY.signInExpired : ACCOUNT_COPY.notSignedIn}>
                {token === null ? (
                    <AccountLineAction
                        disabled={pending}
                        // The OAuth popup opens inside this click; a token server asks for it here.
                        onClick={() => (tokenServer ? setToken("") : signIn(endpoint))}
                    >
                        {ACCOUNT_COPY.signIn}
                    </AccountLineAction>
                ) : null}
            </AccountLine>
            {token !== null ? (
                <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void signInWithToken(endpoint, token.trim()).then((ok) => {
                            if (ok) setToken(null)
                        })
                    }}
                >
                    <Input
                        type="password"
                        autoComplete="off"
                        aria-label={ACCOUNT_COPY.tokenPlaceholder}
                        placeholder={ACCOUNT_COPY.tokenPlaceholder}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        className="ph-no-capture"
                    />
                    <Button type="submit" size="sm" disabled={pending || !token.trim()}>
                        {ACCOUNT_COPY.saveToken}
                    </Button>
                </form>
            ) : null}
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
        </div>
    )
}
