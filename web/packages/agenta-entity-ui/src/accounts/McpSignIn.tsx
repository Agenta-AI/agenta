/**
 * The viewer's own sign-in to one MCP server: the OAuth popup, or a token form for a server that
 * takes a token, and the error line. Shared by the MCP drawer's account line and the setup card,
 * which only differ in the way in and the texts.
 */
import {useState, type ReactNode} from "react"

import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {Button, Input} from "@agenta/ui/ui"

export function McpSignIn({
    endpoint,
    tokenLabel,
    tokenPlaceholder,
    submitLabel,
    children,
}: {
    endpoint: MCPEndpoint
    /** The token field's accessible name. */
    tokenLabel: string
    tokenPlaceholder?: string
    submitLabel: string
    /**
     * The way in. `start` opens the OAuth popup inside the click, or the token form; it is null
     * while the token form is open.
     */
    children: (start: (() => void) | null, pending: boolean) => ReactNode
}) {
    const {pendingId, error, signIn, signInWithToken} = usePersonalMcpSignIn()
    const [token, setToken] = useState<string | null>(null)
    const pending = Boolean(endpoint.id) && pendingId === endpoint.id
    const start = () => (endpoint.auth_mode === "api_key" ? setToken("") : signIn(endpoint))

    return (
        <>
            {children(token === null ? start : null, pending)}
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
                        aria-label={tokenLabel}
                        placeholder={tokenPlaceholder}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        className="ph-no-capture"
                    />
                    <Button type="submit" size="sm" disabled={pending || !token.trim()}>
                        {submitLabel}
                    </Button>
                </form>
            ) : null}
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
        </>
    )
}
