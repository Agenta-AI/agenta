/**
 * What a few servers need before consent: an OAuth app the person registered with the
 * provider, and the scopes to ask for.
 *
 * Advanced holds only what is optional, collapsed. A server that registers no clients and takes
 * no client ID metadata document needs an app of the person's own, so for it the app's fields
 * sit above Advanced, required, and Advanced keeps only the scopes.
 */
import {useRef, useState, type ReactElement, type ReactNode} from "react"

import type {MCPTokenEndpointAuthMethod} from "@agenta/entities/mcpEndpoint"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {copyToClipboard, HeightCollapse} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {ConfigRowCaret} from "@agenta/ui/components/presentational"
import {
    Button,
    Checkbox,
    Field,
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
    /** What Advanced holds, on its row ("Callback URL, client ID, scopes"). */
    summary?: string
    /** Beside the client secret's label: the action that creates a secret. */
    clientSecretAction?: ReactNode
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
    clientSecretAction,
    disabled,
}: OAuthAdvancedFieldsProps) => {
    const t = useT(mcpConnectCatalog)
    const [open, setOpen] = useState(false)
    const hasClient = !!clientId.trim()
    const callbackRef = useRef<HTMLElement>(null)
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

    // A server that registers no clients needs the app: its fields leave Advanced (required).
    const appFields = (
        <>
            {redirectUri ? (
                <Field label={t("entityUi.mcpConnect.callbackUrl")}>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex h-8 items-center gap-2 rounded-lg bg-muted pl-3 pr-1">
                            <code
                                ref={callbackRef}
                                className="min-w-0 flex-1 truncate text-code-sm text-muted-foreground"
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
                            <p className="m-0 text-meta leading-normal text-muted-foreground">
                                {t("entityUi.mcpConnect.copyByHand")}
                            </p>
                        ) : null}
                    </div>
                </Field>
            ) : null}
            <HintedField
                label={t("entityUi.mcpConnect.clientId")}
                required={needsOwnApp}
                tooltip={needsOwnApp ? undefined : t("entityUi.mcpConnect.clientHelp")}
            >
                <Input
                    className="font-mono text-label"
                    placeholder={needsOwnApp ? undefined : t("entityUi.mcpConnect.optional")}
                    value={clientId}
                    disabled={disabled}
                    aria-label={t("entityUi.mcpConnect.clientId")}
                    onChange={(event) => onClientIdChange(event.target.value)}
                />
            </HintedField>
            {hasClient && authMethod === "none" ? null : (
                <HintedField
                    label={t("entityUi.mcpConnect.clientSecret")}
                    required={needsOwnApp}
                    labelEnd={clientSecretAction}
                >
                    {clientSecret}
                </HintedField>
            )}
            {hasClient ? (
                <Field label={t("entityUi.mcpConnect.clientAuthentication")}>
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
                </Field>
            ) : null}
        </>
    )

    const scopes =
        scopesOffered.length > 0 ? (
            <Field
                label={t("entityUi.mcpConnect.scopes")}
                tooltip={t("entityUi.mcpConnect.scopesHelp")}
            >
                <div
                    role="group"
                    aria-label={t("entityUi.mcpConnect.scopes")}
                    className="flex flex-wrap gap-x-4 gap-y-2"
                >
                    {scopesOffered.map((scope) => (
                        <label
                            key={scope}
                            className="flex cursor-pointer items-center gap-2 text-code-sm text-foreground"
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
            </Field>
        ) : null

    // Advanced holds only what is optional; with nothing optional left it is not drawn.
    const advanced = needsOwnApp ? scopes : (
        <>
            {appFields}
            {scopes}
        </>
    )
    const hasAdvanced = !needsOwnApp || scopes !== null

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-oauth-advanced">
            {needsOwnApp ? (
                <div className="flex flex-col gap-3" data-testid="mcp-oauth-app">
                    <Field
                        label={t("entityUi.mcpConnect.oauthApp")}
                        tooltip={t("entityUi.mcpConnect.ownOauthAppNotice")}
                    >
                        {null}
                    </Field>
                    {appFields}
                </div>
            ) : null}
            {hasAdvanced ? (
                <div className="flex flex-col">
                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start gap-2 px-2 text-foreground"
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                    >
                        <SlidersHorizontal size={14} className="shrink-0 text-muted-foreground" />
                        <span className="text-label font-medium leading-5">
                            {t("entityUi.mcpConnect.advanced")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-right text-meta text-muted-foreground">
                            {summary}
                        </span>
                        <ConfigRowCaret open={open} className="text-muted-foreground" />
                    </Button>
                    <HeightCollapse open={open} fade contentClassName="flex flex-col gap-3 pt-3">
                        {advanced}
                    </HeightCollapse>
                </div>
            ) : null}
        </div>
    )
}

export default OAuthAdvancedFields
