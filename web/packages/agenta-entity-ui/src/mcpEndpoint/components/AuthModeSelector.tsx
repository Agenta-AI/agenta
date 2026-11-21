/**
 * How the connection authenticates, chosen by the person.
 *
 * The probe only suggests a mode. A server that publishes OAuth metadata may also take a
 * personal token, and one that answered without a key may give higher limits with one, so the
 * probe's answer is marked "Detected" and the person can pick another.
 */
import type {MCPAuthMode} from "@agenta/entities/mcpEndpoint"
import {useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Badge, Segmented} from "@agenta/ui/ui"

type McpConnectKey = CatalogKey<typeof mcpConnectCatalog>

/** Catalog keys; translate with the `entityUi.mcpConnect` catalog where the label renders. */
export const MCP_AUTH_MODE_LABEL: Record<MCPAuthMode, McpConnectKey> = {
    none: "entityUi.mcpConnect.authNone",
    api_key: "entityUi.mcpConnect.authApiKey",
    oauth: "entityUi.mcpConnect.authOauth",
}

const ORDER: MCPAuthMode[] = ["none", "api_key", "oauth"]

/** Said when the choice moves away from what the probe found, to say why one might. */
const AWAY_FROM_DETECTED: Partial<Record<MCPAuthMode, McpConnectKey>> = {
    oauth: "entityUi.mcpConnect.awayFromOauth",
    none: "entityUi.mcpConnect.awayFromNone",
}

const OAUTH_UNAVAILABLE: McpConnectKey = "entityUi.mcpConnect.oauthUnavailable"

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
    const t = useT(mcpConnectCatalog)
    const hints = [
        detected && value !== detected ? AWAY_FROM_DETECTED[detected] : null,
        oauthSelectable ? null : OAUTH_UNAVAILABLE,
    ].filter((key): key is McpConnectKey => Boolean(key))

    return (
        <div className="flex flex-col gap-1.5" data-testid="mcp-auth-mode">
            <span className="text-xs font-medium text-colorText">
                {t("entityUi.mcpConnect.authentication")}
            </span>
            <Segmented
                block
                aria-label={t("entityUi.mcpConnect.authentication")}
                value={value}
                disabled={disabled}
                onChange={(mode) => onChange(mode as MCPAuthMode)}
                options={ORDER.map((mode) => ({
                    value: mode,
                    disabled: mode === "oauth" && !oauthSelectable,
                    label: (
                        <>
                            {t(MCP_AUTH_MODE_LABEL[mode])}
                            {mode === detected ? (
                                <Badge>{t("entityUi.mcpConnect.detected")}</Badge>
                            ) : null}
                        </>
                    ),
                }))}
            />
            {hints.length ? (
                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                    {hints.map((key) => t(key)).join(" ")}
                </p>
            ) : null}
        </div>
    )
}

export default AuthModeSelector
