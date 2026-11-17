/**
 * Builds the one secret an `Authorization: Basic` server needs, from a username and a password.
 *
 * The person used to encode `username:password` themselves and paste the result into a
 * secret, and nothing on the screen said so. This encodes once, in the browser, and hands the
 * value to the existing secret create flow, so the project holds one secret and nothing else.
 * The username and password live only in these two fields and are cleared once handed over.
 */
import {useState} from "react"

import {basicCredentialValue} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Button, Field, Input} from "@agenta/ui/ui"

export interface BasicCredentialHelperProps {
    disabled?: boolean
    /** Called with the encoded value, to be saved as one project secret. */
    onCreateSecret: (value: string) => void
}

export const BasicCredentialHelper = ({disabled, onCreateSecret}: BasicCredentialHelperProps) => {
    const t = useT(mcpConnectCatalog)
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    // Basic splits `username:password` at the first colon, so a colon in the username would
    // move part of it into the password. A password may hold one.
    const usernameHasColon = username.includes(":")

    return (
        <div
            className="flex flex-col gap-3 rounded-control border border-solid border-colorBorderSecondary p-3"
            data-testid="mcp-basic-helper"
        >
            <span className="text-xs font-medium text-colorText">
                {t("entityUi.mcpConnect.basicTitle")}
            </span>
            <div className="grid grid-cols-2 gap-2">
                <Field
                    label={t("entityUi.mcpConnect.username")}
                    className="gap-1.5"
                    error={usernameHasColon ? t("entityUi.mcpConnect.usernameColon") : undefined}
                >
                    <Input
                        placeholder={t("entityUi.mcpConnect.apiLogin")}
                        value={username}
                        disabled={disabled}
                        autoComplete="off"
                        onChange={(event) => setUsername(event.target.value)}
                    />
                </Field>
                <Field label={t("entityUi.mcpConnect.password")} className="gap-1.5">
                    <Input
                        type="password"
                        placeholder={t("entityUi.mcpConnect.apiPassword")}
                        value={password}
                        disabled={disabled}
                        autoComplete="new-password"
                        onChange={(event) => setPassword(event.target.value)}
                    />
                </Field>
            </div>
            <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                {t("entityUi.mcpConnect.basicHint")}
            </p>
            <div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !username || !password || usernameHasColon}
                    onClick={() => {
                        onCreateSecret(basicCredentialValue(username, password))
                        setUsername("")
                        setPassword("")
                    }}
                >
                    {t("entityUi.mcpConnect.createSecret")}
                </Button>
            </div>
        </div>
    )
}

export default BasicCredentialHelper
