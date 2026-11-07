/**
 * The project's MCP connections, as one settings section both hosts mount.
 *
 * It lives here rather than in `web/oss` so the desktop and the mobile app render the same
 * surface from the same code. That is the whole reason the integrations section next door
 * takes a copy override, and this follows it.
 *
 * The list shows stored connections only. Provider-managed rows belong with the
 * integrations they come from, not under a heading about MCP servers.
 *
 * This page is the registry and nothing else: it says which servers the project has and how
 * each one authenticates. What a server may actually do is a property of an agent, not of the
 * connection, so permissions are reachable from here only read-only ("View tools").
 */
import {type ReactNode, useCallback, useMemo, useState} from "react"

import {
    mcpReconnectTarget,
    connectionNameProblem,
    deleteMcpEndpointAtom,
    editMcpEndpoint,
    disconnectMcpEndpointAtom,
    getMcpConnectionCheckLabel,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
    readMcpConnectionHealth,
    mcpEndpointsQueryAtom,
    readMcpToolCount,
    refreshMcpEndpointsAtom,
    type McpConnectionStatus,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom, personalAccountsAccessAtom} from "@agenta/entities/secret"
import {
    McpConnectJourney,
    McpConnectionDetail,
    McpPermissionDrawer,
} from "@agenta/entity-ui/mcpEndpoint"
import {useT, createT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsMcpCatalog from "@agenta/i18n/catalogs/settings.mcp"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, IconTile} from "@agenta/ui/ui"
import {
    ArrowsClockwise,
    LinkBreak,
    PencilSimpleLine,
    Plugs,
    Plus,
    Trash,
    Wrench,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {ConfirmDestructive} from "../confirm"
import {SettingsPageActions} from "../SettingsPageShell"
import {showsYours} from "../shared/accountOwners"
import {InlineName} from "../shared/InlineName"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsGroupHeading} from "../shared/SettingsGroupHeading"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

import {McpYoursTable, personalSignInServers} from "./McpYoursTable"

const tNow = createT(commonCatalog, settingsMcpCatalog)

/** Per viewer, like the other pages' groups: "Yours" folds away and stays folded. */
const yoursCollapsedAtom = atomWithStorage("agenta:settings:mcps-yours-collapsed", false)

/** Nouns for the rows; a host that calls them something else passes its own. */
export interface McpServersSectionCopy {
    connect: string
    emptyTitle: string
    emptyBody: string
}

const DEFAULT_COPY: Record<
    keyof McpServersSectionCopy,
    CatalogKey<typeof commonCatalog | typeof settingsMcpCatalog>
> = {
    connect: "settings.mcp.connect",
    emptyTitle: "settings.mcp.emptyTitle",
    emptyBody: "settings.mcp.emptyBody",
}

/**
 * How a row's status colours its dot. The words and the derivation are the entity layer's, so
 * this page and the permission drawer cannot drift into two names for one state.
 *
 * "Unreachable" is in the vocabulary and never rendered today: nothing on the connection record
 * reports whether the host answered (issue #6907). `getMcpConnectionStatus` carries the seam and
 * the tone is declared here so the row is right the day the field arrives.
 */
const STATUS_TONE: Record<McpConnectionStatus, "success" | "warning" | "error"> = {
    connected: "success",
    login_expired: "warning",
    not_signed_in: "warning",
    unreachable: "error",
}

/**
 * Whether there is a stored grant this row could give back.
 *
 * Only an OAuth connection: the revoke route refuses anything else outright with "endpoint is
 * not a custom OAuth target" (`gateways/mcps/router.py`), so offering the action on a key row
 * would produce a 400 on a row that reads as connected. A grant the server has stopped honouring
 * still counts — the handle is dropped whether or not the far side still knows about it, which
 * is the state that made a connection report itself ready and then fail every call.
 */
const hasGrantToRevoke = (endpoint: MCPEndpoint) =>
    endpoint.auth_mode === "oauth" && Boolean(endpoint.secret_id)

const COLUMNS: (ListTableColumn & {
    label: CatalogKey<typeof commonCatalog | typeof settingsMcpCatalog>
})[] = [
    {key: "name", label: "common.name", width: "minmax(0,2fr)"},
    {key: "url", label: "settings.mcp.serverUrl", width: "minmax(0,2fr)"},
    {key: "auth", label: "settings.mcp.auth", width: "minmax(0,1fr)"},
    {key: "status", label: "common.status", width: "minmax(0,1.2fr)"},
]

const ACTIONS_COLUMN: ListTableColumn & {
    label: CatalogKey<typeof commonCatalog | typeof settingsMcpCatalog>
} = {
    key: "actions",
    label: "common.actions",
    srOnly: true,
    width: "32px",
}
const PHONE_KEYS = ["name", "status", "actions"]

export interface McpServersSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides every write affordance. */
    readOnly?: boolean
    /**
     * Whether the member may read a server's tool list (`use_mcp_endpoints`). When false the
     * connection detail leaves the tools section out instead of showing the relay's refusal.
     */
    canListTools?: boolean
    copy?: Partial<McpServersSectionCopy>
    /** The project group's heading: the project switch. Shown with "Yours". */
    projectSwitch?: ReactNode
    /** How many projects the person has in the organization, for the empty "Yours" note. */
    projectCount?: number
}

export default function McpServersSection({
    confirm,
    readOnly,
    canListTools = true,
    copy: copyOverrides,
    projectSwitch,
    projectCount,
}: McpServersSectionProps) {
    const t = useT(commonCatalog, settingsMcpCatalog)
    const copy = useMemo<McpServersSectionCopy>(
        () => ({
            connect: t(DEFAULT_COPY.connect),
            emptyTitle: t(DEFAULT_COPY.emptyTitle),
            emptyBody: t(DEFAULT_COPY.emptyBody),
            ...copyOverrides,
        }),
        [t, copyOverrides],
    )

    const {data: endpoints, isPending} = useAtomValue(mcpEndpointsQueryAtom)
    const refresh = useSetAtom(refreshMcpEndpointsAtom)
    const disconnect = useSetAtom(disconnectMcpEndpointAtom)
    const deleteEndpoint = useSetAtom(deleteMcpEndpointAtom)
    const namedSecrets = useAtomValue(customNamedSecretsAtom)
    const access = useAtomValue(personalAccountsAccessAtom)
    const [yoursCollapsed, setYoursCollapsed] = useAtom(yoursCollapsedAtom)

    const [connecting, setConnecting] = useState(false)
    const [reconnecting, setReconnecting] = useState<MCPEndpoint | null>(null)
    /**
     * Which connection is open, by identity rather than by value.
     *
     * Holding the row itself froze it at the moment it was clicked, so a disconnect updated
     * the list underneath while the open connection went on reporting Ready and offering to
     * disconnect again (QA-D2). The row is looked up fresh on every render instead.
     */
    const [viewingKey, setViewingKey] = useState<string | null>(null)
    /** "View tools", tracked by key for the same reason as the connection above. */
    const [toolsKey, setToolsKey] = useState<string | null>(null)
    // The tools drawer's panel: a reconnect started there opens inside it, not over the page.
    const [toolsPanel, setToolsPanel] = useState<HTMLDivElement | null>(null)
    const [renamingKey, setRenamingKey] = useState<string | null>(null)
    const projectId = useAtomValue(projectIdAtom)

    const rows = useMemo(() => endpoints ?? [], [endpoints])
    // A person signs in to the project's servers.
    const yoursServers = useMemo(() => personalSignInServers(rows), [rows])
    const names = useMemo(() => rows.map((row) => row.name), [rows])
    const rowKey = useCallback((record: MCPEndpoint) => record.id ?? record.slug ?? "", [])
    const viewing = useMemo(
        () => rows.find((row) => rowKey(row) === viewingKey) ?? null,
        [rowKey, rows, viewingKey],
    )
    const setViewing = useCallback(
        (record: MCPEndpoint | null) => setViewingKey(record ? rowKey(record) : null),
        [rowKey],
    )
    const viewingTools = useMemo(
        () => rows.find((row) => rowKey(row) === toolsKey) ?? null,
        [rowKey, rows, toolsKey],
    )

    /**
     * The name the project filed a credential under, for the Auth cell.
     *
     * The endpoint stores `secret_id`; the label has to be the name the person chose in the
     * connect sheet, which lives on the vault row. A secret that no longer resolves falls back
     * to the bare kind rather than printing an id — this cell never shows a value, and an id
     * is closer to a value than to a name.
     */
    const secretNameById = useMemo(() => {
        const byId = new Map<string, string>()
        for (const secret of namedSecrets) {
            if (secret.id) byId.set(secret.id, secret.name || secret.slug || "")
        }
        return byId
    }, [namedSecrets])

    const openConnect = useCallback(() => {
        setReconnecting(null)
        setConnecting(true)
    }, [])

    const openReconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            setViewing(null)
            setReconnecting(endpoint)
            setConnecting(true)
        },
        [setViewing],
    )

    const closeConnect = useCallback(() => {
        setConnecting(false)
        setReconnecting(null)
    }, [])

    /**
     * Disconnecting gives back the login. The connection stays.
     *
     * The row remains, reporting Login expired, and Reconnect renews it — which is why the two
     * are separate items rather than one. The confirm sentence is the spec's: agents lose the
     * server's tools because its calls start failing, not because the server went away.
     */
    const handleDisconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || tNow("settings.mcp.thisServer")
            const run = async () => {
                try {
                    await disconnect(endpoint.id as string)
                } catch (error) {
                    message.error(
                        (error as Error)?.message || tNow("settings.mcp.disconnectFailed"),
                    )
                }
            }
            if (!confirm) return void run()
            confirm({
                title: tNow("settings.mcp.disconnectTitle", {name: label}),
                message: tNow("settings.mcp.disconnectMessage"),
                okText: tNow("common.disconnect"),
                danger: true,
                onOk: run,
            })
        },
        [confirm, disconnect],
    )

    /**
     * Removing takes the identity with it, which disconnecting does not.
     *
     * The spec draws no deletion at all, and a spec that does not draw an action does not
     * remove it: without this there is no way to take a server out of a project.
     */
    const handleRemove = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || tNow("settings.mcp.thisServer")
            const run = async () => {
                try {
                    await deleteEndpoint(endpoint.id as string)
                    setViewing(null)
                    setToolsKey(null)
                } catch (error) {
                    message.error((error as Error)?.message || tNow("settings.mcp.removeFailed"))
                }
            }
            if (!confirm) return void run()
            confirm({
                title: tNow("settings.mcp.removeTitle"),
                message: tNow("settings.mcp.removeMessage", {name: label}),
                onOk: run,
            })
        },
        [confirm, deleteEndpoint, setViewing],
    )

    const allColumns = useMemo(
        () =>
            (readOnly ? COLUMNS : [...COLUMNS, ACTIONS_COLUMN]).map((column) => ({
                ...column,
                label: t(column.label),
            })),
        [readOnly, t],
    )
    const {columns, shows} = usePhoneColumns(allColumns, PHONE_KEYS)
    const empty = !isPending && rows.length === 0

    const connect = (
        <Button data-testid="mcp-connect-open" onClick={openConnect}>
            <Plus size={14} />
            {copy.connect}
        </Button>
    )

    const projectTable = (
        <ListTable<MCPEndpoint>
            columns={columns}
            groups={[{key: "servers", label: null, rows}]}
            rowKey={rowKey}
            minWidth={0}
            loading={isPending}
            skeletonRows={3}
            hideHeader={empty}
            onOpenRow={(record) => setViewing(record)}
            empty={
                <SettingsEmpty
                    icon={getSettingsSidebarIcon("mcpEndpoints")}
                    title={copy.emptyTitle}
                    description={copy.emptyBody}
                    action={readOnly ? null : connect}
                />
            }
            renderRow={(record) => {
                const status = getMcpConnectionStatus(record)
                const health = readMcpConnectionHealth(record)
                const checkLabel = health ? getMcpConnectionCheckLabel(health) : null
                const secretName = record.secret_id
                    ? secretNameById.get(record.secret_id)
                    : undefined
                return (
                    <>
                        <span className="flex min-w-0 items-center gap-2.5">
                            {/* One generic glyph for every server: the registry holds arbitrary
                            URLs, so there is no per-server branding to show. */}
                            <IconTile
                                size={28}
                                tone="muted"
                                aria-hidden="true"
                                className="border border-solid border-border bg-muted text-muted-foreground"
                            >
                                <Plugs />
                            </IconTile>
                            <InlineName
                                value={record.name || record.slug || ""}
                                editing={!readOnly && renamingKey === rowKey(record)}
                                ariaLabel={t("settings.mcp.connectionName")}
                                testId="mcp-connection-name"
                                onStart={
                                    readOnly ? undefined : () => setRenamingKey(rowKey(record))
                                }
                                onDone={() => setRenamingKey(null)}
                                validate={(name) =>
                                    connectionNameProblem({
                                        name,
                                        existingNames: names,
                                        currentName: record.name,
                                    })
                                }
                                onSave={async (name) => {
                                    if (!record.id) return
                                    // A full replace: the edit route writes what it is given.
                                    await editMcpEndpoint(
                                        {
                                            id: record.id,
                                            name,
                                            description: record.description,
                                            auth_mode: record.auth_mode,
                                            secret_id: record.secret_id,
                                            data: record.data,
                                            flags: record.flags,
                                        },
                                        projectId ?? undefined,
                                    )
                                    void refresh()
                                }}
                            />
                        </span>
                        {shows("url") ? (
                            <span
                                className="truncate font-mono text-[13px] text-muted-foreground"
                                title={record.data.route.base_url ?? undefined}
                            >
                                {record.data.route.base_url}
                            </span>
                        ) : null}
                        {!shows("auth") ? null : record.auth_mode === "oauth" ? (
                            <span className="truncate">OAuth</span>
                        ) : record.auth_mode === "none" ? (
                            <span className="truncate">{t("common.none")}</span>
                        ) : secretName ? (
                            // Never the credential itself, only what it is filed under.
                            <span className="flex min-w-0 items-center gap-1">
                                <span>{t("settings.mcp.apiKeyPrefix")}</span>
                                <span className="truncate font-mono text-xs">{secretName}</span>
                            </span>
                        ) : (
                            <span className="truncate">{t("settings.mcp.apiKey")}</span>
                        )}
                        <span
                            data-testid="mcp-connection-status"
                            className="flex min-w-0 items-center gap-2"
                        >
                            <span className="flex min-w-0 flex-col">
                                <StatusIndicator
                                    tone={STATUS_TONE[status]}
                                    label={getMcpConnectionStatusLabel(status)}
                                    // min-w-0 lets the label truncate instead of pushing the menu out.
                                    className="min-w-0 text-[13px]"
                                />
                                {checkLabel ? (
                                    <span
                                        data-testid="mcp-connection-check"
                                        className="truncate text-xs text-muted-foreground"
                                        title={checkLabel}
                                    >
                                        {checkLabel}
                                    </span>
                                ) : null}
                            </span>
                        </span>
                        {readOnly ? null : (
                            <SettingsRowMenu
                                label={t("settings.mcp.serverActions")}
                                items={[
                                    {
                                        key: "reconnect",
                                        label: t("common.reconnect"),
                                        icon: <ArrowsClockwise size={14} />,
                                        onClick: () => openReconnect(record),
                                    },
                                    {
                                        key: "view-tools",
                                        label: t("settings.mcp.viewTools"),
                                        icon: <Wrench size={14} />,
                                        hidden: !canListTools,
                                        onClick: () => setToolsKey(rowKey(record)),
                                    },
                                    {
                                        key: "rename",
                                        label: t("common.rename"),
                                        icon: <PencilSimpleLine size={14} />,
                                        deferred: true,
                                        onClick: () => setRenamingKey(rowKey(record)),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "disconnect",
                                        label: t("common.disconnect"),
                                        icon: <LinkBreak size={14} />,
                                        danger: true,
                                        // Only an OAuth grant can be revoked; anything else is a 400.
                                        hidden: !hasGrantToRevoke(record),
                                        onClick: () => handleDisconnect(record),
                                    },
                                    {
                                        key: "remove",
                                        label: t("common.remove"),
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        onClick: () => handleRemove(record),
                                    },
                                ]}
                            />
                        )}
                    </>
                )
            }}
        />
    )

    return (
        <div className="flex flex-col">
            {readOnly ? null : <SettingsPageActions>{connect}</SettingsPageActions>}

            {showsYours(access) ? (
                <div className="flex flex-col gap-8">
                    <McpYoursTable
                        servers={yoursServers}
                        collapsed={yoursCollapsed}
                        onToggle={() => setYoursCollapsed((value) => !value)}
                        confirm={confirm}
                        projectCount={projectCount}
                    />
                    <section className="flex flex-col gap-3">
                        <SettingsGroupHeading
                            label={projectSwitch ?? t("common.project")}
                            count={rows.length}
                        />
                        {projectTable}
                    </section>
                </div>
            ) : (
                projectTable
            )}

            <McpConnectJourney
                // A new controller per attempt. The component unmounts itself while closed,
                // which covers open/close; the key covers the other way in, where a reconnect
                // is chosen while one is already open and the hook would otherwise keep the
                // endpoint it was mounted with.
                key={reconnecting?.id ?? "new"}
                open={connecting}
                onClose={closeConnect}
                existingNames={names}
                reconnect={mcpReconnectTarget(reconnecting)}
                onConnected={() => void refresh()}
                container={viewingTools ? toolsPanel : null}
            />

            {/*
                "View tools" is the agent's permission drawer with nothing to set: the header,
                the groups and the rows, no selects and no footer (decision 23). A Settings row
                belongs to no agent, so there is no policy to read or write here — the empty
                policy and the ignored `onChange` say that, and `readOnly` makes it true rather
                than merely unused.
            */}
            <McpPermissionDrawer
                open={Boolean(viewingTools)}
                onClose={() => setToolsKey(null)}
                slug={viewingTools?.slug ?? undefined}
                connectionName={viewingTools?.name || viewingTools?.slug || undefined}
                // Passed rather than defaulted: the drawer assumes "connected" when given
                // nothing, which would claim a healthy server for a lapsed one.
                status={viewingTools ? getMcpConnectionStatus(viewingTools) : undefined}
                // Null for every row until the query response carries a count, so the header
                // shows none. Wired now so it starts working with no change here.
                cachedToolCount={
                    viewingTools ? (readMcpToolCount(viewingTools) ?? undefined) : undefined
                }
                policy={{}}
                onChange={() => undefined}
                onReconnect={viewingTools ? () => openReconnect(viewingTools) : undefined}
                readOnly
                panelRef={setToolsPanel}
            />

            <McpConnectionDetail
                endpoint={viewing}
                onClose={() => setViewing(null)}
                existingNames={names}
                onReconnect={openReconnect}
                onDisconnect={handleDisconnect}
                onChanged={refresh}
                readOnly={readOnly}
                canListTools={canListTools}
            />
        </div>
    )
}
