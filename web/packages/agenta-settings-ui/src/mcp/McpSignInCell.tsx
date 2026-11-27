/** A person's own sign-in to a project server: whose account runs it, a status, never an owner. */
import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsMcpCatalog from "@agenta/i18n/catalogs/settings.mcp"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"

/** Whether the server asks each person to sign in. */
export const asksForSignIn = (endpoint: MCPEndpoint): boolean => endpoint.auth_mode !== "none"

/** Whether the person's own sign-in to this server is ready. */
export const isSignedIn = (endpoint: MCPEndpoint): boolean =>
    endpoint.user_sign_in?.is_ready === true

export interface McpSignInCellProps {
    endpoint: MCPEndpoint
    /** A sign-in is running; the hook tracks one at a time. */
    pending: boolean
    onSignIn: (endpoint: MCPEndpoint) => void
}

/** "Signed in as You", or a Sign in button; empty where the server asks for no sign-in. */
export const McpSignInCell = ({endpoint, pending, onSignIn}: McpSignInCellProps) => {
    const t = useT(commonCatalog, settingsMcpCatalog)
    if (!asksForSignIn(endpoint)) return <span />
    return (
        <span
            data-testid="mcp-personal-status"
            className="flex min-w-0 items-center"
            title={endpoint.user_sign_in?.account_name ?? undefined}
        >
            {isSignedIn(endpoint) ? (
                <StatusIndicator
                    tone="success"
                    label={t("settings.mcp.signedInAsYou")}
                    className="min-w-0 text-label"
                />
            ) : (
                <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={(event) => {
                        event.stopPropagation()
                        onSignIn(endpoint)
                    }}
                >
                    {t("common.signIn")}
                </Button>
            )}
        </span>
    )
}
