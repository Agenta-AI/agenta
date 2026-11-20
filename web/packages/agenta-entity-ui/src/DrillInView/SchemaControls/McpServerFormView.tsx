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
    mcpReconnectTarget,
    buildMcpConnectionRef,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    getMcpConnectionStatus,
    isLegacyMcpItem,
    mcpEndpointsQueryAtom,
    readMcpPolicy,
    readMcpConnectionSlug,
    readMcpToolCount,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {requirementForItem} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import toolFormCatalog from "@agenta/i18n/catalogs/entityUi.toolForm"
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
import McpPermissionDrawer from "../../mcpEndpoint/McpPermissionDrawer"

import {NeedsSetupTag} from "./agentTemplate/NeedsSetupTag"
import {needsSetupReasonText} from "./agentTemplate/needsSetupText"
import {useAgentRequirements} from "./agentTemplate/useAgentRequirements"

export interface McpServerFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

export function McpServerFormView({value, onChange, disabled}: McpServerFormViewProps) {
    const t = useT(toolFormCatalog)
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    /**
     * Which journey is open, because two controls here open the same sheet for opposite
     * reasons. "Connect MCP" in the picker makes a new connection; the expired-login banner
     * repairs the one this item already names. A single boolean sent both to the new-connect
     * entry, so Reconnect opened a blank sheet at address entry and the way out of an expired
     * login was to make a SECOND connection and repoint the agent at it (round 6c, D132).
     */
    const [connecting, setConnecting] = useState<"new" | "reconnect" | null>(null)
    const [permissionsOpen, setPermissionsOpen] = useState(false)
    // The permission drawer's panel: a reconnect started there opens inside it, not over the page.
    const [permissionsPanel, setPermissionsPanel] = useState<HTMLDivElement | null>(null)

    const endpoints = useMemo(() => endpointsQuery.data ?? [], [endpointsQuery.data])
    const selectedSlug = readMcpConnectionSlug(value)
    const selected = endpoints.find((endpoint) => endpoint.slug === selectedSlug)
    const legacy = isLegacyMcpItem(value)
    // The saved server the server's check reports as missing or turned off.
    const requirements = useAgentRequirements()
    const requirement = requirements
        ? requirementForItem(requirements, {kinds: ["mcp_server"], slug: selectedSlug})
        : undefined

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
            <RailField label={t("entityUi.toolForm.connection")} align="center">
                <Select
                    value={selectedSlug && selected ? selectedSlug : undefined}
                    onValueChange={(slug) => {
                        const endpoint = endpoints.find((row) => row.slug === slug)
                        if (endpoint) chooseConnection(endpoint)
                    }}
                    disabled={disabled}
                >
                    <SelectTrigger
                        className="w-full"
                        aria-label={t("entityUi.toolForm.connection")}
                    >
                        <SelectValue
                            placeholder={
                                // An unsaved item the server has not checked keeps the local wording.
                                selectedSlug && !selected && !requirement
                                    ? t("entityUi.toolForm.connectionUnavailable")
                                    : t("entityUi.toolForm.selectConnection")
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {endpoints.length === 0 ? (
                            <div className="px-3 py-input-y-ghost text-field-md text-colorTextSecondary">
                                {t("entityUi.toolForm.noMcpConnections")}
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
                            onClick={() => setConnecting("new")}
                            className="min-h-control w-full justify-start gap-2 rounded-control-sm px-3 py-1 text-field-md font-normal"
                        >
                            <Plus size={13} className="shrink-0" />
                            {t("entityUi.toolForm.connectMcp")}
                        </Button>
                    </SelectContent>
                </Select>
            </RailField>

            {requirement ? (
                <RailField label={t("entityUi.toolForm.status")} align="center">
                    <NeedsSetupTag reason={needsSetupReasonText(requirement.reason)} />
                </RailField>
            ) : null}

            {selected && !requirement ? (
                <RailField label={t("entityUi.toolForm.status")} align="center">
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
                        t("entityUi.toolForm.toolPrefix"),
                        t("entityUi.toolForm.toolPrefixHint"),
                    )}
                    align="center"
                >
                    <span className="text-field-md text-[var(--ag-colorTextSecondary)]">
                        {prefix}
                    </span>
                </RailField>
            ) : null}

            <RailField label={t("entityUi.toolForm.permissions")} align="center">
                {/* A link out, not the editor inline. The per-tool table is the densest
                    surface in the feature and it was nested two panels deep inside the
                    shallowest one; it is now one destination that the rail row reaches
                    directly too, so setting permissions is one navigation either way. */}
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || !selected?.slug}
                    onClick={() => setPermissionsOpen(true)}
                >
                    {t("entityUi.toolForm.setPermissions")}
                </Button>
            </RailField>

            {legacy ? (
                // Saved before connections had their own identity. It still resolves, and
                // re-picking it here moves it onto the current shape.
                <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">
                    {t("entityUi.toolForm.legacyServer")}
                </p>
            ) : null}

            {prefix === RESERVED_TOOL_PREFIX ? (
                <p className="m-0 text-xs text-[var(--ag-colorError)]">
                    {t("entityUi.toolForm.prefixReserved")}
                </p>
            ) : null}

            {permissionsOpen ? (
                <McpPermissionDrawer
                    open
                    onClose={() => setPermissionsOpen(false)}
                    slug={selected?.slug ?? undefined}
                    connectionName={selected?.name || selected?.slug || undefined}
                    toolPrefix={prefix || undefined}
                    policy={readMcpPolicy(value)}
                    onChange={(policy) => onChange({...value, policy})}
                    onReconnect={() => setConnecting("reconnect")}
                    status={selected ? getMcpConnectionStatus(selected) : undefined}
                    cachedToolCount={selected ? readMcpToolCount(selected) : null}
                    disabled={disabled}
                    panelRef={setPermissionsPanel}
                />
            ) : null}

            {connecting ? (
                <McpConnectJourney
                    open
                    container={permissionsOpen ? permissionsPanel : null}
                    onClose={() => setConnecting(null)}
                    existingNames={endpoints.map((endpoint) => endpoint.name)}
                    reconnect={connecting === "reconnect" ? mcpReconnectTarget(selected) : null}
                    onConnected={({slug, name}) => {
                        // Only a new connection is selected for this agent. A reconnect
                        // renewed the login on the connection this item already names, so
                        // the reference stays, and with it the tool prefix frozen when the
                        // server was added.
                        if (connecting === "new") {
                            onChange({
                                ...value,
                                name: toolPrefixFromName(name) ?? slug,
                                connection: buildMcpConnectionRef(slug),
                            })
                        }
                        setConnecting(null)
                    }}
                />
            ) : null}
        </div>
    )
}
