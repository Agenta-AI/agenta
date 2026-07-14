/**
 * Structured editor for one external HTTP MCP server.
 */
import {useState} from "react"

import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {Input, Select, Tag} from "antd"
import {useAtomValue} from "jotai"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

type Dict = Record<string, string>
type CredentialType = "none" | "header_secret_refs"
type AuthenticationType = CredentialType | "oauth"

interface McpCredentials {
    type?: CredentialType
    headers?: Dict
}

interface McpConnection {
    type?: "http"
    url?: string
    headers?: Dict
    credentials?: McpCredentials
}

interface McpServer {
    name?: string
    connection?: McpConnection
    policy?: Record<string, unknown>
}

export interface McpServerFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

export function McpServerFormView({value, onChange, disabled}: McpServerFormViewProps) {
    const namedSecrets = useAtomValue(customNamedSecretsAtom)
    const server = value as McpServer
    const connection = server.connection ?? {
        type: "http" as const,
        url: "",
        credentials: {type: "none" as const},
    }
    const credentials = connection.credentials ?? {type: "none" as const}
    const credentialType = credentials.type ?? "none"
    const initialSecretHeader = Object.entries(credentials.headers ?? {})[0] ?? ["", ""]
    const [secretHeader, setSecretHeader] = useState({
        name: initialSecretHeader[0],
        slug: initialSecretHeader[1],
    })

    const name = server.name ?? ""
    const invalidName = Boolean(name) && !MCP_SERVER_NAME_PATTERN.test(name)
    const selectedSecretExists = namedSecrets.some((secret) => secret.slug === secretHeader.slug)

    const setServer = (patch: Partial<McpServer>) => {
        onChange({...value, ...patch})
    }

    const setConnection = (patch: Partial<McpConnection>) => {
        setServer({
            connection: {
                ...connection,
                type: "http",
                ...patch,
            },
        })
    }

    const writeSecretHeader = (next: {name: string; slug: string}) => {
        setSecretHeader(next)
        setConnection({
            credentials: {
                type: "header_secret_refs",
                headers: next.name && next.slug ? {[next.name]: next.slug} : {},
            },
        })
    }

    const setAuthenticationType = (type: AuthenticationType) => {
        if (type === "oauth") return
        setConnection({
            credentials:
                type === "none"
                    ? {type: "none"}
                    : {
                          type: "header_secret_refs",
                          headers:
                              secretHeader.name && secretHeader.slug
                                  ? {[secretHeader.name]: secretHeader.slug}
                                  : {},
                      },
        })
    }

    return (
        <div className="flex flex-col gap-3">
            <RailField label="Server name">
                <Input
                    value={name}
                    onChange={(event) => setServer({name: event.target.value})}
                    placeholder="exa"
                    status={invalidName ? "error" : undefined}
                    disabled={disabled}
                />
                {invalidName ? (
                    <span className="mt-1 text-xs text-[var(--ag-colorError)]">
                        Use only letters, numbers, dots, hyphens, or underscores.
                    </span>
                ) : null}
            </RailField>

            <RailField label="MCP URL" align="center">
                <Input
                    value={connection.url ?? ""}
                    onChange={(event) => setConnection({url: event.target.value})}
                    placeholder="https://example.com/mcp"
                    disabled={disabled}
                />
            </RailField>

            <RailField label="Authentication" align="center">
                <Select<AuthenticationType>
                    className="w-full"
                    value={credentialType}
                    onChange={setAuthenticationType}
                    disabled={disabled}
                    options={[
                        {label: "None", value: "none"},
                        {label: "Secret header", value: "header_secret_refs"},
                        {
                            label: (
                                <span className="flex items-center justify-between gap-2">
                                    OAuth
                                    <Tag className="m-0 text-[10px]">Soon</Tag>
                                </span>
                            ),
                            value: "oauth",
                            disabled: true,
                        },
                    ]}
                />
            </RailField>

            {credentialType === "header_secret_refs" ? (
                <>
                    <RailField
                        label={railInfoLabel(
                            "Header name",
                            "The HTTP header required by the MCP server, for example x-api-key",
                        )}
                        align="center"
                    >
                        <Input
                            value={secretHeader.name}
                            onChange={(event) =>
                                writeSecretHeader({
                                    ...secretHeader,
                                    name: event.target.value.trim(),
                                })
                            }
                            placeholder="x-api-key"
                            disabled={disabled}
                        />
                    </RailField>

                    <RailField
                        label={railInfoLabel(
                            "Project secret",
                            "The selected secret is resolved securely when the agent runs",
                        )}
                        align="center"
                    >
                        <Select
                            className="w-full"
                            value={selectedSecretExists ? secretHeader.slug : undefined}
                            onChange={(slug) => writeSecretHeader({...secretHeader, slug})}
                            placeholder={
                                secretHeader.slug && !selectedSecretExists
                                    ? "Selected secret is unavailable"
                                    : "Select a project secret"
                            }
                            disabled={disabled}
                            notFoundContent="No project secrets found"
                            options={namedSecrets
                                .filter((secret) => Boolean(secret.slug))
                                .map((secret) => ({
                                    label: secret.name || "Unnamed secret",
                                    value: secret.slug as string,
                                }))}
                        />
                    </RailField>
                </>
            ) : null}
        </div>
    )
}
