/**
 * McpServerFormView
 *
 * Structured form view for an MCP server, the Form side of {@link ConfigItemDrawer}. Mirrors
 * the MCPServerConfig shape (sdks/python/agenta/sdk/agents/mcp/models.py): name, transport
 * (stdio command/args/env, or http url), vault secret-name map, and an optional exposed-tool
 * allowlist. It edits only those known keys so the object stays valid (the backend model is
 * `extra="forbid"`).
 *
 * Re-mount it per server (key on the open item) so the local key/value text state seeds
 * cleanly.
 */
import {useState} from "react"

import {Input, Select} from "antd"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

import {CodeEditor} from "./CodeEditor"

type Dict = Record<string, string>

interface McpServer {
    name?: string
    transport?: "stdio" | "http"
    command?: string
    args?: string[]
    env?: Dict
    url?: string
    secrets?: Dict
    tools?: string[]
}

export interface McpServerFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

/** `KEY=value` per line ↔ a string map. Local text state avoids cursor jumps on edit. */
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
            .map(([k, v]) => `${k}=${v}`)
            .join("\n"),
    )

    const handle = (next: string) => {
        setText(next)
        const obj: Dict = {}
        next.split("\n").forEach((line) => {
            const i = line.indexOf("=")
            if (i > 0) {
                const k = line.slice(0, i).trim()
                if (k) obj[k] = line.slice(i + 1).trim()
            }
        })
        onChange(obj)
    }

    return (
        <Input.TextArea
            value={text}
            onChange={(e) => handle(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoSize={{minRows: 2, maxRows: 6}}
            className="font-mono"
        />
    )
}

export function McpServerFormView({value, onChange, disabled}: McpServerFormViewProps) {
    const server = (value ?? {}) as McpServer
    const transport = server.transport ?? "stdio"

    const set = (key: keyof McpServer, fieldValue: unknown) => {
        const next = {...(value ?? {})}
        if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
            delete (next as Record<string, unknown>)[key]
        } else {
            ;(next as Record<string, unknown>)[key] = fieldValue
        }
        onChange(next)
    }

    return (
        <div className="flex flex-col gap-3">
            <RailField label="Server name" align="center">
                <Input
                    value={server.name ?? ""}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="my-mcp-server"
                    disabled={disabled}
                />
            </RailField>

            <RailField label="Transport" align="center">
                <Select
                    className="w-full"
                    value={transport}
                    onChange={(v) => set("transport", v)}
                    disabled={disabled}
                    options={[
                        {label: "stdio (local command)", value: "stdio"},
                        {label: "http (remote URL)", value: "http"},
                    ]}
                />
            </RailField>

            {transport === "stdio" ? (
                <>
                    <RailField label="Command">
                        <CodeEditor
                            value={server.command ?? ""}
                            onChange={(v) => set("command", v)}
                            placeholder="npx"
                            disabled={disabled}
                        />
                    </RailField>
                    <RailField label="Arguments" align="center">
                        <Select
                            mode="tags"
                            className="w-full"
                            value={server.args ?? []}
                            onChange={(v) => set("args", v)}
                            placeholder="one argument per token"
                            disabled={disabled}
                            open={false}
                            suffixIcon={null}
                        />
                    </RailField>
                </>
            ) : (
                <RailField label="Server URL" align="center">
                    <Input
                        value={server.url ?? ""}
                        onChange={(e) => set("url", e.target.value)}
                        placeholder="https://example.com/mcp"
                        disabled={disabled}
                    />
                </RailField>
            )}

            <RailField label={railInfoLabel("Environment", "KEY=value per line")}>
                <KeyValueLines
                    value={server.env}
                    onChange={(env) => set("env", Object.keys(env).length ? env : undefined)}
                    placeholder={"NODE_ENV=production"}
                    disabled={disabled}
                />
            </RailField>

            <RailField
                label={railInfoLabel(
                    "Secrets",
                    "Map an env var to a vault secret name: ENV_VAR=secret_name",
                )}
            >
                <KeyValueLines
                    value={server.secrets}
                    onChange={(secrets) =>
                        set("secrets", Object.keys(secrets).length ? secrets : undefined)
                    }
                    placeholder={"API_KEY=my_api_key"}
                    disabled={disabled}
                />
            </RailField>

            <RailField
                label={railInfoLabel(
                    "Exposed tools",
                    "Optional allowlist — leave empty to expose all of the server's tools",
                )}
                align="center"
            >
                <Select
                    mode="tags"
                    className="w-full"
                    value={server.tools ?? []}
                    onChange={(v) => set("tools", v.length ? v : undefined)}
                    placeholder="tool names"
                    disabled={disabled}
                    open={false}
                    suffixIcon={null}
                />
            </RailField>
        </div>
    )
}
