/**
 * What a few servers need before consent: an OAuth app the person registered with the
 * provider, and the scopes to ask for.
 *
 * Collapsed by default, because most servers register Agenta on their own and offer scopes
 * nobody needs to narrow, so the usual OAuth screen stays the three elements it was. A
 * server that registers no clients and takes no client ID metadata document opens it, and
 * says why: without an app of the person's own there is nothing to sign in as.
 */
import {cloneElement, useId, useRef, useState, type ReactElement} from "react"

import type {MCPTokenEndpointAuthMethod} from "@agenta/entities/mcpEndpoint"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {copyToClipboard} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    Checkbox,
    CollapseCaret,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Copy, SlidersHorizontal} from "@phosphor-icons/react"

import {HintedField} from "./HintedField"

// The copy toast fires from a click handler.
const tNow = createT(mcpConnectCatalog)

/** Catalog keys, translated where the options render. */
const AUTH_METHOD_LABEL: Record<
    MCPTokenEndpointAuthMethod,
    CatalogKey<typeof mcpConnectCatalog>
> = {
    client_secret_post: "entityUi.mcpConnect.authMethodPost",
    client_secret_basic: "entityUi.mcpConnect.authMethodBasic",
    none: "entityUi.mcpConnect.authMethodNone",
}

export interface OAuthAdvancedFieldsProps {
    clientId: string
    onClientIdChange: (clientId: string) => void
    /** The project-secret picker for the app's secret, labelled by this section. */
    clientSecret: ReactElement<{"aria-describedby"?: string}>
    authMethod: MCPTokenEndpointAuthMethod
    onAuthMethodChange: (method: MCPTokenEndpointAuthMethod) => void
    /** Agenta's callback, as the API reports it. Absent until a probe has answered. */
    redirectUri: string | null
    scopesOffered: string[]
    scopesSelected: string[]
    onToggleScope: (scope: string) => void
    /** The server signs in only an app registered with it by hand. */
    needsOwnApp: boolean
    /** What the section holds, on its row ("Callback URL, client ID, scopes"). */
    summary?: string
    disabled?: boolean
}

export const OAuthAdvancedFields = ({
    clientId,
    onClientIdChange,
    clientSecret,
    authMethod,
    onAuthMethodChange,
    redirectUri,
    scopesOffered,
    scopesSelected,
    onToggleScope,
    needsOwnApp,
    summary,
    disabled,
}: OAuthAdvancedFieldsProps) => {
    const t = useT(mcpConnectCatalog)
    // Null until the person toggles it, so a server that needs an app opens it by itself.
    const [toggled, setToggled] = useState<boolean | null>(null)
    const open = toggled ?? needsOwnApp
    const hasClient = !!clientId.trim()
    const callbackRef = useRef<HTMLElement>(null)
    const introId = useId()
    const [copyFailed, setCopyFailed] = useState(false)

    const copyCallback = async () => {
        if (!redirectUri) return
        if (await copyToClipboard(redirectUri)) {
            setCopyFailed(false)
            message.success(tNow("entityUi.mcpConnect.copiedToClipboard"))
            return
        }
        // A page served over plain HTTP has no clipboard, so the URL is selected instead and
        // the person copies it by hand.
        if (callbackRef.current) window.getSelection()?.selectAllChildren(callbackRef.current)
        setCopyFailed(true)
    }

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-oauth-advanced">
            {/* A section row (canvas F03 f5): the glyph, the title, what is inside, a caret. */}
            <button
                type="button"
                className="flex h-10 w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-colorSplit bg-transparent px-1 text-left font-[inherit] text-colorText outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-ring max-md:h-11"
                aria-expanded={open}
                onClick={() => setToggled(!open)}
            >
                <SlidersHorizontal size={14} className="shrink-0 text-colorTextSecondary" />
                <span className="text-[13px] font-medium leading-5">
                    {t("entityUi.mcpConnect.advanced")}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-[12px] leading-4 text-colorTextSecondary">
                    {summary}
                </span>
                <CollapseCaret open={open} size={10} className="text-colorText" />
            </button>
            {open ? (
                <div className="flex flex-col gap-4">
                    <p id={introId} className="m-0 text-xs leading-normal text-colorTextSecondary">
                        {needsOwnApp
                            ? t("entityUi.mcpConnect.ownOauthAppNotice")
                            : t("entityUi.mcpConnect.clientHelp")}
                    </p>
                    {redirectUri ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-field-md text-colorText">
                                {t("entityUi.mcpConnect.callbackUrl")}
                            </span>
                            <div className="flex h-8 items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer pl-3 pr-1">
                                <code
                                    ref={callbackRef}
                                    className="min-w-0 flex-1 truncate font-mono text-xs text-colorTextSecondary"
                                    title={redirectUri}
                                >
                                    {redirectUri}
                                </code>
                                <Button variant="ghost" size="xs" onClick={copyCallback}>
                                    <Copy data-icon="inline-start" />
                                    {t("entityUi.mcpConnect.copy")}
                                </Button>
                            </div>
                            {copyFailed ? (
                                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                                    {t("entityUi.mcpConnect.copyByHand")}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    <HintedField label={t("entityUi.mcpConnect.clientId")}>
                        <Input
                            className="font-mono text-[13px]"
                            placeholder={
                                needsOwnApp ? undefined : t("entityUi.mcpConnect.optional")
                            }
                            value={clientId}
                            disabled={disabled}
                            aria-label={t("entityUi.mcpConnect.clientId")}
                            aria-describedby={introId}
                            onChange={(event) => onClientIdChange(event.target.value)}
                        />
                    </HintedField>
                    {hasClient && authMethod === "none" ? null : (
                        <HintedField label={t("entityUi.mcpConnect.clientSecret")}>
                            {cloneElement(clientSecret, {"aria-describedby": introId})}
                        </HintedField>
                    )}
                    {hasClient ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-field-md text-colorText">
                                {t("entityUi.mcpConnect.clientAuthentication")}
                            </span>
                            <Select
                                value={authMethod}
                                onValueChange={(value) =>
                                    onAuthMethodChange(value as MCPTokenEndpointAuthMethod)
                                }
                            >
                                <SelectTrigger
                                    className="w-full"
                                    disabled={disabled}
                                    aria-label={t("entityUi.mcpConnect.clientAuthentication")}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(AUTH_METHOD_LABEL).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                            {t(label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : null}
                    {scopesOffered.length > 0 ? (
                        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                            <legend className="mb-1.5 p-0 text-field-md text-colorText">
                                {t("entityUi.mcpConnect.scopes")}
                            </legend>
                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {scopesOffered.map((scope) => (
                                    <label
                                        key={scope}
                                        className="flex cursor-pointer items-center gap-2 font-mono text-xs text-colorText"
                                    >
                                        <Checkbox
                                            checked={scopesSelected.includes(scope)}
                                            disabled={disabled}
                                            onCheckedChange={() => onToggleScope(scope)}
                                        />
                                        {scope}
                                    </label>
                                ))}
                            </div>
                            <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                                {t("entityUi.mcpConnect.scopesHelp")}
                            </p>
                        </fieldset>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default OAuthAdvancedFields
