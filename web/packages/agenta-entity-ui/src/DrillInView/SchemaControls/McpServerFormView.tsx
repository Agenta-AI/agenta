/**
 * Structured editor for one external HTTP MCP server.
 */
import {useState} from "react"

import {Input, Select} from "antd"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

type Dict = Record<string, string>
type CredentialType = "none" | "header_secret_refs"

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

function KeyValueLines({
    value,
    onChange,
    placeholder,
    disabled,
}: {
    value: Dict | undefined
    onChange: (next: Dict) => void
    placeholder?: string
    disabled?: boolean
}) {
    const [text, setText] = useState(() =>
        Object.entries(value ?? {})
            .map(([key, entryValue]) => `${key}=${entryValue}`)
            .join("\n"),
    )

    const handle = (next: string) => {
        setText(next)
        const entries: Dict = {}
        next.split("\n").forEach((line) => {
            const separator = line.indexOf("=")
            if (separator <= 0) return
            const key = line.slice(0, separator).trim()
            if (key) entries[key] = line.slice(separator + 1).trim()
        })
        onChange(entries)
    }

    return (
        <Input.TextArea
            value={text}
            onChange={(event) => handle(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoSize={{minRows: 2, maxRows: 6}}
            className="font-mono"
        />
    )
}

export function McpServerFormView({value, onChange, disabled}: McpServerFormViewProps) {
    const server = value as McpServer
    const connection = server.connection ?? {
        type: "http" as const,
        url: "",
        credentials: {type: "none" as const},
    }
    const credentials = connection.credentials ?? {type: "none" as const}
    const credentialType = credentials.type ?? "none"

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

    const setCredentialType = (type: CredentialType) => {
        setConnection({
            credentials:
                type === "none"
                    ? {type: "none"}
                    : {type: "header_secret_refs", headers: credentials.headers ?? {}},
        })
    }

    return (
        <div className="flex flex-col gap-3">
            <RailField label="Server name" align="center">
                <Input
                    value={server.name ?? ""}
                    onChange={(event) => setServer({name: event.target.value})}
                    placeholder="memory"
                    disabled={disabled}
                />
            </RailField>

            <RailField label="MCP URL" align="center">
                <Input
                    value={connection.url ?? ""}
                    onChange={(event) => setConnection({url: event.target.value})}
                    placeholder="https://example.com/mcp"
                    disabled={disabled}
                />
            </RailField>

            <RailField label={railInfoLabel("Public headers", "Non-secret HTTP headers only")}>
                <KeyValueLines
                    value={connection.headers}
                    onChange={(headers) =>
                        setConnection({headers: Object.keys(headers).length ? headers : undefined})
                    }
                    placeholder="X-Workspace=my-workspace"
                    disabled={disabled}
                />
            </RailField>

            <RailField label="Authentication" align="center">
                <Select<CredentialType>
                    className="w-full"
                    value={credentialType}
                    onChange={setCredentialType}
                    disabled={disabled}
                    options={[
                        {label: "None", value: "none"},
                        {label: "Secret headers", value: "header_secret_refs"},
                    ]}
                />
            </RailField>

            {credentialType === "header_secret_refs" ? (
                <RailField
                    label={railInfoLabel(
                        "Secret headers",
                        "Map an HTTP header to a project secret name",
                    )}
                >
                    <KeyValueLines
                        value={credentials.headers}
                        onChange={(headers) =>
                            setConnection({
                                credentials: {type: "header_secret_refs", headers},
                            })
                        }
                        placeholder="Authorization=memory_token"
                        disabled={disabled}
                    />
                </RailField>
            ) : null}
        </div>
    )
}
