/**
 * Which MCP connection this agent uses.
 *
 * The form used to author a server: URL, authentication, header, secret. All of that moved
 * into the connect journey, which asks the server itself rather than asking the person to
 * describe it. What is left here is the only question that belongs to an agent — which
 * connection, of the ones this project has — plus a way to add one without leaving the page.
 *
 * Two fields are written, and they are not the same thing. `connection.slug` is the endpoint
 * the gateway resolves at run time. `name` is the prefix the model sees on this server's
 * tools, frozen from the display name when the connection is chosen; renaming the connection
 * in settings afterwards does not rename tools in an agent that is already saved.
 */
import {useCallback, useMemo, useState} from "react"

import {
    buildMcpConnectionRef,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    isLegacyMcpItem,
    mcpEndpointsQueryAtom,
    readMcpConnectionSlug,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {Tag} from "@agenta/ui/components/presentational"
import {
    Button,
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
import McpConnectJourney from "../../mcpEndpoint/McpConnectJourney"

export interface McpServerFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

export function McpServerFormView({value, onChange, disabled}: McpServerFormViewProps) {
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const [connecting, setConnecting] = useState(false)

    const endpoints = useMemo(() => endpointsQuery.data ?? [], [endpointsQuery.data])
    const selectedSlug = readMcpConnectionSlug(value)
    const selected = endpoints.find((endpoint) => endpoint.slug === selectedSlug)
    const legacy = isLegacyMcpItem(value)

    /** Point the item at a connection, and freeze the tool prefix from its label. */
    const chooseConnection = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.slug) return
            const label = endpoint.name || endpoint.slug
            onChange({
                ...value,
                // Frozen here and not recomputed later: a rename must not rename tools.
                name: toolPrefixFromName(label) ?? endpoint.slug,
                connection: buildMcpConnectionRef(endpoint.slug),
            })
        },
        [onChange, value],
    )

    const prefix = typeof value.name === "string" ? value.name : ""

    return (
        <div className="flex flex-col gap-3">
            <RailField label="Connection" align="center">
                <Select
                    value={selectedSlug && selected ? selectedSlug : undefined}
                    onValueChange={(slug) => {
                        const endpoint = endpoints.find((row) => row.slug === slug)
                        if (endpoint) chooseConnection(endpoint)
                    }}
                    disabled={disabled}
                >
                    <SelectTrigger className="w-full" aria-label="Connection">
                        <SelectValue
                            placeholder={
                                selectedSlug && !selected
                                    ? "This connection is no longer available"
                                    : "Select a connection"
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {endpoints.length === 0 ? (
                            <div className="px-3 py-input-y-ghost text-field-md text-colorTextSecondary">
                                No MCP connections yet
                            </div>
                        ) : (
                            endpoints.map((endpoint) => (
                                <SelectItem
                                    key={endpoint.slug}
                                    value={endpoint.slug as string}
                                    disabled={!endpoint.slug}
                                >
                                    {endpoint.name || endpoint.slug}
                                </SelectItem>
                            ))
                        )}
                        <SelectSeparator />
                        {/* Not a SelectItem: it is an action, not a value. */}
                        <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => setConnecting(true)}
                            className="min-h-control w-full justify-start gap-2 rounded-control-sm px-3 py-1 text-field-md font-normal"
                        >
                            <Plus size={13} className="shrink-0" />
                            Connect MCP
                        </Button>
                    </SelectContent>
                </Select>
            </RailField>

            {selected ? (
                <RailField label="Status" align="center">
                    <div className="flex min-w-0 items-center gap-2">
                        <Tag
                            tone={getMcpConnectionState(selected) === "ready" ? "green" : "gold"}
                            className="m-0 text-xs"
                        >
                            {getMcpConnectionStateLabel(getMcpConnectionState(selected))}
                        </Tag>
                        <span
                            className="truncate text-xs text-[var(--ag-colorTextSecondary)]"
                            title={selected.data.route.base_url ?? undefined}
                        >
                            {selected.data.route.base_url}
                        </span>
                    </div>
                </RailField>
            ) : null}

            {prefix ? (
                <RailField
                    label={railInfoLabel(
                        "Tool prefix",
                        "What the model sees on this server's tools. Frozen when the connection was chosen, so renaming the connection does not rename tools here.",
                    )}
                    align="center"
                >
                    <span className="text-field-md text-[var(--ag-colorTextSecondary)]">
                        {prefix}
                    </span>
                </RailField>
            ) : null}

            {legacy ? (
                // Saved before connections had their own identity. It still resolves, and
                // re-picking it here moves it onto the current shape.
                <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">
                    This server was configured before connections were shared across agents. Select
                    it again above to link it to a connection.
                </p>
            ) : null}

            {prefix === RESERVED_TOOL_PREFIX ? (
                <p className="m-0 text-xs text-[var(--ag-colorError)]">
                    That prefix is reserved. Rename the connection and select it again.
                </p>
            ) : null}

            {connecting ? (
                <McpConnectJourney
                    open
                    onClose={() => setConnecting(false)}
                    existingNames={endpoints.map((endpoint) => endpoint.name)}
                    // Selects the new connection for THIS agent only; nothing else changes.
                    onConnected={({slug, name}) => {
                        onChange({
                            ...value,
                            name: toolPrefixFromName(name) ?? slug,
                            connection: buildMcpConnectionRef(slug),
                        })
                        setConnecting(false)
                    }}
                />
            ) : null}
        </div>
    )
}
