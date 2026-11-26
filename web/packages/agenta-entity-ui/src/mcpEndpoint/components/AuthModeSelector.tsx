/**
 * How the connection authenticates, chosen by the person.
 *
 * The probe only suggests a mode. A server that publishes OAuth metadata may also take a
 * personal token, and one that answered without a key may give higher limits with one, so the
 * probe's answer is marked "Detected" and the person can pick another.
 *
 * Drawn as pill chips in the order OAuth, API key, None, the picked chip filled (canvas F03 f5).
 */
import {useRef, type KeyboardEvent} from "react"

import type {MCPAuthMode} from "@agenta/entities/mcpEndpoint"
import {useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {cn} from "@agenta/ui/ui"

type McpConnectKey = CatalogKey<typeof mcpConnectCatalog>

/** Catalog keys; translate with the `entityUi.mcpConnect` catalog where the label renders. */
export const MCP_AUTH_MODE_LABEL: Record<MCPAuthMode, McpConnectKey> = {
    none: "entityUi.mcpConnect.authNone",
    api_key: "entityUi.mcpConnect.authApiKey",
    oauth: "entityUi.mcpConnect.authOauth",
}

const ORDER: MCPAuthMode[] = ["oauth", "api_key", "none"]

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
    const refs = useRef<(HTMLButtonElement | null)[]>([])
    const hints = [
        detected && value !== detected ? AWAY_FROM_DETECTED[detected] : null,
        oauthSelectable ? null : OAUTH_UNAVAILABLE,
    ].filter((key): key is McpConnectKey => Boolean(key))
    const enabled = ORDER.filter((mode) => mode !== "oauth" || oauthSelectable)

    // Arrow keys move the choice and the focus together, as in a radio group.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return
        const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0
        if (!step) return
        event.preventDefault()
        const at = Math.max(0, enabled.indexOf(value))
        const next = enabled[(at + step + enabled.length) % enabled.length]
        onChange(next)
        refs.current[ORDER.indexOf(next)]?.focus()
    }

    return (
        <div className="flex flex-col gap-1" data-testid="mcp-auth-mode">
            <span className="text-[12px] font-medium leading-4 text-colorTextSecondary">
                {t("entityUi.mcpConnect.authentication")}
            </span>
            <div
                role="radiogroup"
                aria-label={t("entityUi.mcpConnect.authentication")}
                className="flex flex-wrap items-center gap-2"
                onKeyDown={onKeyDown}
            >
                {ORDER.map((mode, index) => {
                    const selected = mode === value
                    return (
                        <button
                            key={mode}
                            ref={(node) => {
                                refs.current[index] = node
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            tabIndex={selected ? 0 : -1}
                            disabled={disabled || (mode === "oauth" && !oauthSelectable)}
                            onClick={() => {
                                if (!selected) onChange(mode)
                            }}
                            className={cn(
                                // 26px on the canvas; a 44px target on a phone.
                                "flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full border border-solid py-0 pl-2.5 font-[inherit] text-[12px] leading-5 outline-none transition-colors max-md:h-11",
                                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
                                "disabled:cursor-not-allowed disabled:opacity-50",
                                mode === detected ? "pr-0.5" : "pr-2.5",
                                selected
                                    ? "border-colorText bg-colorText text-colorBgContainer"
                                    : "border-colorBorder bg-colorBgContainer text-colorText enabled:hover:bg-colorFillQuaternary",
                            )}
                        >
                            {t(MCP_AUTH_MODE_LABEL[mode])}
                            {mode === detected ? (
                                <span className="rounded-full bg-colorBgContainer px-2 text-[12px] leading-4 text-colorTextSecondary">
                                    {t("entityUi.mcpConnect.detected")}
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
            {hints.length ? (
                <p className="m-0 text-[12px] leading-4 text-colorTextTertiary">
                    {hints.map((key) => t(key)).join(" ")}
                </p>
            ) : null}
        </div>
    )
}

export default AuthModeSelector
