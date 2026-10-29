/**
 * How the connection authenticates, chosen by the person.
 *
 * The probe only suggests a mode. A server that publishes OAuth metadata may also take a
 * personal token, and one that answered without a key may give higher limits with one, so the
 * probe's answer is marked "Detected" and the person can pick another.
 */
import type {MCPAuthMode} from "@agenta/entities/mcpEndpoint"
import {Badge, Segmented} from "@agenta/ui/ui"

export const MCP_AUTH_MODE_LABEL: Record<MCPAuthMode, string> = {
    none: "None",
    api_key: "API key",
    oauth: "OAuth",
}

const ORDER: MCPAuthMode[] = ["none", "api_key", "oauth"]

/** Said when the choice moves away from what the probe found, to say why one might. */
const AWAY_FROM_DETECTED: Partial<Record<MCPAuthMode, string>> = {
    oauth: "The probe found OAuth. Pick API key if this server also accepts a key you already have.",
    none: "The server answered without a key. Add one if your plan gives you a key for higher limits.",
}

const OAUTH_UNAVAILABLE = "OAuth is available when the server offers OAuth sign-in."

export interface AuthModeSelectorProps {
    value: MCPAuthMode
    /** What the probe found. Null where nothing was probed, as on a reconnect. */
    detected: MCPAuthMode | null
    /** Consent needs the metadata the probe read, so OAuth is offered only where it found it. */
    oauthSelectable: boolean
    disabled?: boolean
    onChange: (mode: MCPAuthMode) => void
}

export const AuthModeSelector = ({
    value,
    detected,
    oauthSelectable,
    disabled,
    onChange,
}: AuthModeSelectorProps) => {
    const hints = [
        detected && value !== detected ? AWAY_FROM_DETECTED[detected] : null,
        oauthSelectable ? null : OAUTH_UNAVAILABLE,
    ].filter(Boolean)

    return (
        <div className="flex flex-col gap-1.5" data-testid="mcp-auth-mode">
            <span className="text-xs font-medium text-colorText">Authentication</span>
            <Segmented
                block
                aria-label="Authentication"
                value={value}
                disabled={disabled}
                onChange={(mode) => onChange(mode as MCPAuthMode)}
                options={ORDER.map((mode) => ({
                    value: mode,
                    disabled: mode === "oauth" && !oauthSelectable,
                    label: (
                        <>
                            {MCP_AUTH_MODE_LABEL[mode]}
                            {mode === detected ? <Badge>Detected</Badge> : null}
                        </>
                    ),
                }))}
            />
            {hints.length ? (
                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                    {hints.join(" ")}
                </p>
            ) : null}
        </div>
    )
}

export default AuthModeSelector
