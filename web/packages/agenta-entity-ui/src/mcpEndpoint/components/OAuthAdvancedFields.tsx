/**
 * What a few servers need before consent: an OAuth app the person registered with the
 * provider, and the scopes to ask for.
 *
 * Collapsed by default, because most servers register Agenta on their own and offer scopes
 * nobody needs to narrow, so the usual OAuth screen stays the three elements it was. A
 * server that registers no clients and takes no client ID metadata document opens it, and
 * says why: without an app of the person's own there is nothing to sign in as.
 */
import {useState, type ReactElement} from "react"

import {Button, Checkbox, cn, Input, touchTargetExpansion} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {HintedField} from "./HintedField"

export const OWN_OAUTH_APP_NOTICE =
    "This server needs an OAuth app you register yourself. Paste its client ID and secret."

const CLIENT_HELP =
    "Only for servers that do not register clients on their own. Most do, and these stay blank."

const SCOPES_HELP =
    "All scopes the server offers are checked. Uncheck one to ask for less. Servers that offer no scopes show nothing here."

export interface OAuthAdvancedFieldsProps {
    clientId: string
    onClientIdChange: (clientId: string) => void
    /** The project-secret picker for the app's secret, labelled by this section. */
    clientSecret: ReactElement<{"aria-describedby"?: string}>
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
    scopesOffered,
    scopesSelected,
    onToggleScope,
    needsOwnApp,
    disabled,
}: OAuthAdvancedFieldsProps) => {
    // Null until the person toggles it, so a server that needs an app opens it by itself.
    const [toggled, setToggled] = useState<boolean | null>(null)
    const open = toggled ?? needsOwnApp
    const Caret = open ? CaretDown : CaretRight

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-oauth-advanced">
            <Button
                variant="link"
                size="xs"
                className={cn(
                    "self-start px-0 text-xs text-colorTextSecondary",
                    touchTargetExpansion(24),
                )}
                aria-expanded={open}
                onClick={() => setToggled(!open)}
            >
                <Caret size={12} data-icon="inline-start" />
                Advanced
            </Button>
            {open ? (
                <div className="flex flex-col gap-3">
                    {needsOwnApp ? (
                        <p className="m-0 text-xs leading-normal text-colorText">
                            {OWN_OAUTH_APP_NOTICE}
                        </p>
                    ) : null}
                    <HintedField label="Client ID">
                        <Input
                            className="font-mono text-[13px]"
                            placeholder="Optional"
                            value={clientId}
                            disabled={disabled}
                            aria-label="Client ID"
                            onChange={(event) => onClientIdChange(event.target.value)}
                        />
                    </HintedField>
                    <HintedField label="Client secret" hint={CLIENT_HELP}>
                        {clientSecret}
                    </HintedField>
                    {scopesOffered.length > 0 ? (
                        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                            <legend className="mb-1.5 p-0 text-field-md text-colorText">
                                Scopes
                            </legend>
                            {scopesOffered.map((scope) => (
                                <label
                                    key={scope}
                                    className="flex cursor-pointer items-center gap-2 text-xs"
                                >
                                    <Checkbox
                                        checked={scopesSelected.includes(scope)}
                                        disabled={disabled}
                                        onCheckedChange={() => onToggleScope(scope)}
                                    />
                                    <span className="font-mono text-colorText">{scope}</span>{" "}
                                    <span className="text-colorTextTertiary">
                                        offered by the server
                                    </span>
                                </label>
                            ))}
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
