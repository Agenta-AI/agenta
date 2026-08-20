/**
 * Structured editor for one external HTTP MCP server.
 */
import {useState} from "react"

import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {
    Badge,
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"
import {CreateSecretDrawer} from "../../secret"

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
    const [secretSelectOpen, setSecretSelectOpen] = useState(false)
    const [createSecretOpen, setCreateSecretOpen] = useState(false)
    // Latches on first open so the create drawer's hooks stay unmounted until it is needed.
    const [createSecretMounted, setCreateSecretMounted] = useState(false)

    const name = server.name ?? ""
    const invalidName = Boolean(name) && !MCP_SERVER_NAME_PATTERN.test(name)
    const selectedSecretExists = namedSecrets.some((secret) => secret.slug === secretHeader.slug)
    const secretOptions = namedSecrets
        .filter((secret) => Boolean(secret.slug))
        .map((secret) => ({label: secret.name || "Unnamed secret", value: secret.slug as string}))

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
                    aria-label="Server name"
                    aria-invalid={invalidName || undefined}
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
                    aria-label="MCP URL"
                    disabled={disabled}
                />
            </RailField>

            <RailField label="Authentication" align="center">
                <Select
                    value={credentialType}
                    onValueChange={(next) => setAuthenticationType(next as AuthenticationType)}
                    disabled={disabled}
                >
                    <SelectTrigger className="w-full" aria-label="Authentication">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="header_secret_refs">Secret header</SelectItem>
                        <SelectItem value="oauth" disabled>
                            <span className="flex flex-1 items-center justify-between gap-2">
                                OAuth
                                <Badge className="text-[12px]">Soon</Badge>
                            </span>
                        </SelectItem>
                    </SelectContent>
                </Select>
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
                            aria-label="Header name"
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
                            value={selectedSecretExists ? secretHeader.slug : undefined}
                            onValueChange={(slug) => writeSecretHeader({...secretHeader, slug})}
                            open={secretSelectOpen}
                            onOpenChange={setSecretSelectOpen}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-full" aria-label="Project secret">
                                <SelectValue
                                    placeholder={
                                        secretHeader.slug && !selectedSecretExists
                                            ? "Selected secret is unavailable"
                                            : "Select a project secret"
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {secretOptions.length === 0 ? (
                                    <div className="px-3 py-input-y-ghost text-field-md text-colorTextSecondary">
                                        No project secrets found
                                    </div>
                                ) : (
                                    secretOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))
                                )}
                                <SelectSeparator />
                                {/* Not a SelectItem: it is an action, not a value. Controlled-open
                                    lets it close the dropdown and open the drawer cleanly. */}
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setCreateSecretMounted(true)
                                        setSecretSelectOpen(false)
                                        setCreateSecretOpen(true)
                                    }}
                                    className="min-h-control w-full justify-start gap-2 rounded-control-sm px-3 py-1 text-field-md font-normal"
                                >
                                    <Plus size={13} className="shrink-0" />
                                    Create secret
                                </Button>
                            </SelectContent>
                        </Select>
                    </RailField>

                    {createSecretMounted ? (
                        <CreateSecretDrawer
                            open={createSecretOpen}
                            onClose={() => setCreateSecretOpen(false)}
                            headerName={secretHeader.name}
                            serverName={name}
                            onCreated={(row) =>
                                writeSecretHeader({...secretHeader, slug: row.slug})
                            }
                        />
                    ) : null}
                </>
            ) : null}
        </div>
    )
}
