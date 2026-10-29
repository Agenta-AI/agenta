/**
 * What a few servers need before consent: an OAuth app the person registered with the
 * provider, and the scopes to ask for.
 *
 * Collapsed by default, because most servers register Agenta on their own and offer scopes
 * nobody needs to narrow, so the usual OAuth screen stays the three elements it was. A
 * server that registers no clients and takes no client ID metadata document opens it, and
 * says why: without an app of the person's own there is nothing to sign in as.
 */
import {useRef, useState, type ReactElement} from "react"

import type {MCPTokenEndpointAuthMethod} from "@agenta/entities/mcpEndpoint"
import {copyToClipboard} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    Checkbox,
    cn,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {CaretDown, Copy, SlidersHorizontal} from "@phosphor-icons/react"

import {HintedField} from "./HintedField"

export const OWN_OAUTH_APP_NOTICE =
    "This server needs an OAuth app you register yourself. Add the callback URL to it, then paste its client ID and secret."

const CLIENT_HELP = "Only needed when the server does not register clients on its own. Most do."

const SCOPES_HELP = "Uncheck a scope to ask for less."

const COPY_BY_HAND = "Select the URL and copy it."

const AUTH_METHOD_LABEL: Record<MCPTokenEndpointAuthMethod, string> = {
    client_secret_post: "Send the secret in the request body",
    client_secret_basic: "Send the secret with Basic authentication",
    none: "No secret",
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
    disabled,
}: OAuthAdvancedFieldsProps) => {
    // Null until the person toggles it, so a server that needs an app opens it by itself.
    const [toggled, setToggled] = useState<boolean | null>(null)
    const open = toggled ?? needsOwnApp
    const hasClient = !!clientId.trim()
    const callbackRef = useRef<HTMLElement>(null)
    const [copyFailed, setCopyFailed] = useState(false)

    const copyCallback = async () => {
        if (!redirectUri) return
        if (await copyToClipboard(redirectUri)) {
            setCopyFailed(false)
            message.success("Copied to clipboard!")
            return
        }
        // A page served over plain HTTP has no clipboard, so the URL is selected instead and
        // the person copies it by hand.
        if (callbackRef.current) window.getSelection()?.selectAllChildren(callbackRef.current)
        setCopyFailed(true)
    }

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-oauth-advanced">
            <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-2 text-xs text-colorTextSecondary"
                aria-expanded={open}
                onClick={() => setToggled(!open)}
            >
                <SlidersHorizontal size={14} data-icon="inline-start" />
                <span className="flex-1 text-left">Advanced</span>
                <CaretDown
                    size={12}
                    data-icon="inline-end"
                    className={cn("transition-transform", open && "rotate-180")}
                />
            </Button>
            {open ? (
                <div className="flex flex-col gap-4">
                    <p className="m-0 text-xs leading-normal text-colorTextSecondary">
                        {needsOwnApp ? OWN_OAUTH_APP_NOTICE : CLIENT_HELP}
                    </p>
                    {redirectUri ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-field-md text-colorText">Callback URL</span>
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
                                    Copy
                                </Button>
                            </div>
                            {copyFailed ? (
                                <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                                    {COPY_BY_HAND}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex flex-col gap-4">
                        <HintedField label="Client ID">
                            <Input
                                className="font-mono text-[13px]"
                                placeholder={needsOwnApp ? undefined : "Optional"}
                                value={clientId}
                                disabled={disabled}
                                aria-label="Client ID"
                                onChange={(event) => onClientIdChange(event.target.value)}
                            />
                        </HintedField>
                        {hasClient && authMethod === "none" ? null : (
                            <HintedField label="Client secret">{clientSecret}</HintedField>
                        )}
                    </div>
                    {hasClient ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-field-md text-colorText">
                                Client authentication
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
                                    aria-label="Client authentication"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(AUTH_METHOD_LABEL).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : null}
                    {scopesOffered.length > 0 ? (
                        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                            <legend className="mb-1.5 p-0 text-field-md text-colorText">
                                Scopes
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
                                {SCOPES_HELP}
                            </p>
                        </fieldset>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default OAuthAdvancedFields
