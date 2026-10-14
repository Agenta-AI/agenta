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
import {Button, Field, Input} from "@agenta/ui/ui"

export interface BasicCredentialHelperProps {
    disabled?: boolean
    /** Called with the encoded value, to be saved as one project secret. */
    onCreateSecret: (value: string) => void
}

export const BasicCredentialHelper = ({disabled, onCreateSecret}: BasicCredentialHelperProps) => {
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")

    return (
        <div
            className="flex flex-col gap-3 rounded-control border border-solid border-colorBorderSecondary p-3"
            data-testid="mcp-basic-helper"
        >
            <span className="text-xs font-medium text-colorText">
                Basic (username and password)
            </span>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Username" className="gap-1.5">
                    <Input
                        placeholder="API login"
                        value={username}
                        disabled={disabled}
                        autoComplete="off"
                        onChange={(event) => setUsername(event.target.value)}
                    />
                </Field>
                <Field label="Password" className="gap-1.5">
                    <Input
                        type="password"
                        placeholder="API password"
                        value={password}
                        disabled={disabled}
                        autoComplete="new-password"
                        onChange={(event) => setPassword(event.target.value)}
                    />
                </Field>
            </div>
            <p className="m-0 text-xs leading-normal text-colorTextTertiary">
                Encoded once and stored as one project secret. The username and password are not
                kept.
            </p>
            <div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !username || !password}
                    onClick={() => {
                        onCreateSecret(basicCredentialValue(username, password))
                        setUsername("")
                        setPassword("")
                    }}
                >
                    Create secret
                </Button>
            </div>
        </div>
    )
}

export default BasicCredentialHelper
