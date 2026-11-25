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
import {useCallback, useMemo, useState} from "react"

import {
    usePersonalMcpSignIn,
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
    refreshMcpEndpointsAtom,
    type McpConnectionStatus,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom, personalAccountsAccessAtom} from "@agenta/entities/secret"
import {
    McpConnectJourney,
    McpConnectionDetail,
    McpServerToolsSheet,
} from "@agenta/entity-ui/mcpEndpoint"
import {useT, createT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsMcpCatalog from "@agenta/i18n/catalogs/settings.mcp"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {projectIdAtom} from "@agenta/shared/state"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    LIST_COLUMN_WIDTH,
    ListTable,
    ListTableNameCell,
    type ListTableColumn,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {
    ArrowsClockwise,
    LinkBreak,
    PencilSimpleLine,
    Plus,
    Pulse,
    SignIn,
    SignOut,
    SquaresFour,
    Trash,
    Wrench,
} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"
import {SettingsPageActions} from "../SettingsPageShell"
import {showsYours} from "../shared/accountOwners"
import {ConnectionsToolbar} from "../shared/ConnectionsToolbar"
import {InlineName} from "../shared/InlineName"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

import {asksForSignIn, isSignedIn, McpSignInCell} from "./McpSignInCell"
import {McpTokenSignInDialog} from "./McpTokenSignInDialog"

const tNow = createT(commonCatalog, settingsMcpCatalog)

/** The Status filter: every server, the connected ones, or the ones that need attention. */
type StatusFilter = "all" | "connected" | "attention"

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

type ColumnLabel = CatalogKey<typeof commonCatalog | typeof settingsMcpCatalog>
type McpColumn = ListTableColumn & {label: ColumnLabel}

const NAME_COLUMN: McpColumn = {key: "name", label: "common.name", width: "minmax(160px,1.4fr)"}
const URL_COLUMN: McpColumn = {key: "url", label: "settings.mcp.serverUrl", width: "minmax(0,1fr)"}
const STATUS_COLUMN: McpColumn = {key: "status", label: "common.status", width: LIST_COLUMN_WIDTH.secondary}
/** The person's own sign-in: run-as, never ownership, so a status cell beside the server's. */
const SIGN_IN_COLUMN: McpColumn = {key: "signin", label: "settings.mcp.yourSignIn", width: LIST_COLUMN_WIDTH.name}
const ACTIONS_COLUMN: McpColumn = {
    key: "actions",
    label: "common.actions",
    srOnly: true,
    width: LIST_COLUMN_WIDTH.actions,
}

const columnsFor = (personal: boolean): McpColumn[] =>
    personal
        ? [NAME_COLUMN, URL_COLUMN, STATUS_COLUMN, SIGN_IN_COLUMN, ACTIONS_COLUMN]
        : [NAME_COLUMN, URL_COLUMN, STATUS_COLUMN, ACTIONS_COLUMN]

/** A phone keeps the name and the menu; the person's sign-in moves under the name. */
const phoneKeysFor = (personal: boolean) =>
    personal ? ["name", "actions"] : ["name", "status", "actions"]

const matches = (endpoint: MCPEndpoint, term: string) =>
    !term ||
    [endpoint.name, endpoint.slug, endpoint.data.route.base_url].some((value) =>
        value?.toLowerCase().includes(term),
    )


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
}

export default function McpServersSection({
    confirm,
    readOnly,
    canListTools = true,
    copy: copyOverrides,
}: McpServersSectionProps) {
    const t = useT(commonCatalog, settingsMcpCatalog, settingsSharedCatalog)
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
    const personal = showsYours(useAtomValue(personalAccountsAccessAtom))
    const signIn = usePersonalMcpSignIn()
    const [tokenFor, setTokenFor] = useState<MCPEndpoint | null>(null)
    const [search, setSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

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
    const [renamingKey, setRenamingKey] = useState<string | null>(null)
    const projectId = useAtomValue(projectIdAtom)

    const allRows = useMemo(() => endpoints ?? [], [endpoints])
    const term = search.trim().toLowerCase()
    const rows = useMemo(
        () =>
            allRows.filter(
                (row) =>
                    matches(row, term) &&
                    (statusFilter === "all" ||
                        (getMcpConnectionStatus(row) === "connected") ===
                            (statusFilter === "connected")),
            ),
        [allRows, statusFilter, term],
    )
    const narrowed = Boolean(term) || statusFilter !== "all"
    const names = useMemo(() => allRows.map((row) => row.name), [allRows])
    const rowKey = useCallback((record: MCPEndpoint) => record.id ?? record.slug ?? "", [])
    const viewing = useMemo(
        () => allRows.find((row) => rowKey(row) === viewingKey) ?? null,
        [allRows, rowKey, viewingKey],
    )
    const setViewing = useCallback(
        (record: MCPEndpoint | null) => setViewingKey(record ? rowKey(record) : null),
        [rowKey],
    )
    const viewingTools = useMemo(
        () => allRows.find((row) => rowKey(row) === toolsKey) ?? null,
        [allRows, rowKey, toolsKey],
    )

    // An OAuth sign-in opens its popup inside the click; a token server asks for the token.
    const startSignIn = useCallback(
        (endpoint: MCPEndpoint) => {
            if (endpoint.auth_mode === "api_key") setTokenFor(endpoint)
            else signIn.signIn(endpoint)
        },
        [signIn],
    )

    const confirmSignOut = useCallback(
        (endpoint: MCPEndpoint) => {
            const run = () => signIn.signOut(endpoint)
            if (!confirm) return void run()
            confirm({
                title: tNow("settings.mcp.signOutOf", {
                    name: endpoint.name || endpoint.slug || tNow("settings.mcp.thisServer"),
                }),
                message: tNow("settings.mcp.signOutMessage"),
                okText: tNow("common.signOut"),
                danger: true,
                onOk: run,
            })
        },
        [confirm, signIn],
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
                title: tNow("settings.mcp.removeTitle", {name: label}),
                message: tNow("settings.mcp.removeMessage", {name: label}),
                okText: tNow("common.remove"),
                danger: true,
                onOk: run,
            })
        },
        [confirm, deleteEndpoint, setViewing],
    )

    const allColumns = useMemo(
        () => columnsFor(personal).map((column) => ({...column, label: t(column.label)})),
        [personal, t],
    )
    const {columns, shows} = usePhoneColumns(allColumns, phoneKeysFor(personal))

    const statusSection = useMemo<FilterMenuSection>(
        () => ({
            key: "status",
            label: t("common.status"),
            icon: <Pulse size={14} />,
            value: statusFilter,
            defaultValue: "all",
            options: [
                {value: "all", label: t("settings.shared.ownerAll"), icon: <SquaresFour size={14} />},
                {
                    value: "connected",
                    label: getMcpConnectionStatusLabel("connected"),
                    icon: <span aria-hidden className="size-1.5 rounded-round bg-success" />,
                },
                {
                    value: "attention",
                    label: t("common.needsAttention"),
                    icon: <span aria-hidden className="size-1.5 rounded-round bg-warning" />,
                },
            ],
            onChange: (value) => setStatusFilter(value as StatusFilter),
        }),
        [statusFilter, t],
    )

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
            hideHeader={false}
            onOpenRow={(record) => setViewing(record)}
            empty={
                narrowed ? (
                    <SettingsEmpty
                        compact
                        icon={getSettingsSidebarIcon("mcpEndpoints")}
                        title={t("settings.shared.noMatchTitle")}
                        description={t("settings.shared.noMatchBody")}
                        action={
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setSearch("")
                                    setStatusFilter("all")
                                }}
                            >
                                {t("settings.shared.resetFilters")}
                            </Button>
                        }
                    />
                ) : (
                    <SettingsEmpty
                        compact
                        icon={getSettingsSidebarIcon("mcpEndpoints")}
                        title={copy.emptyTitle}
                        description={copy.emptyBody}
                        action={readOnly ? null : connect}
                    />
                )
            }
            renderRow={(record) => {
                const status = getMcpConnectionStatus(record)
                const health = readMcpConnectionHealth(record)
                const checkLabel = health ? getMcpConnectionCheckLabel(health) : null
                const secretName = record.secret_id
                    ? secretNameById.get(record.secret_id)
                    : undefined
                // How the server signs in, under its name; never the credential itself.
                const authLine =
                    record.auth_mode === "oauth" ? (
                        t("settings.mcp.oauth")
                    ) : record.auth_mode === "none" ? undefined : secretName ? (
                        <>
                            {t("settings.mcp.apiKeyPrefix")}{" "}
                            <span className="text-code">{secretName}</span>
                        </>
                    ) : (
                        t("settings.mcp.apiKey")
                    )
                return (
                    <>
                        {renamingKey === rowKey(record) && !readOnly ? (
                            <span className="flex min-w-0 items-center gap-3">
                                <McpServerMark size={32} name={record.name || record.slug} />
                                <InlineName
                                    value={record.name || record.slug || ""}
                                    editing
                                    ariaLabel={t("settings.mcp.connectionName")}
                                    testId="mcp-connection-name"
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
                        ) : (
                            <ListTableNameCell
                                // One glyph for every server; the tile color follows the name.
                                mark={<McpServerMark size={32} name={record.name || record.slug} />}
                                title={record.name || record.slug || ""}
                                // A phone's meta line: a broken server first, then the sign-in.
                                meta={
                                    shows("url")
                                        ? authLine
                                        : !personal
                                          ? (record.data.route.base_url ?? undefined)
                                        : status !== "connected"
                                          ? getMcpConnectionStatusLabel(status)
                                          : asksForSignIn(record)
                                            ? isSignedIn(record)
                                                ? t("settings.mcp.signedInAsYou")
                                                : t("settings.mcp.notSignedIn")
                                            : (record.data.route.base_url ?? undefined)
                                }
                                metaTone={
                                    shows("url") || !personal || status === "connected"
                                        ? "muted"
                                        : "danger"
                                }
                            />
                        )}
                        {shows("url") ? (
                            <span
                                className="truncate text-label text-muted-foreground"
                                title={record.data.route.base_url ?? undefined}
                            >
                                {record.data.route.base_url}
                            </span>
                        ) : null}
                        {!shows("status") ? null : (
                        <span
                            data-testid="mcp-connection-status"
                            className="flex min-w-0 items-center gap-2"
                        >
                            <span className="flex min-w-0 flex-col">
                                <StatusIndicator
                                    tone={STATUS_TONE[status]}
                                    label={getMcpConnectionStatusLabel(status)}
                                    // min-w-0 lets the label truncate instead of pushing the menu out.
                                    className="min-w-0 text-label"
                                />
                                {checkLabel ? (
                                    <span
                                        data-testid="mcp-connection-check"
                                        className="truncate text-meta text-muted-foreground"
                                        title={checkLabel}
                                    >
                                        {checkLabel}
                                    </span>
                                ) : null}
                            </span>
                        </span>
                        )}
                        {shows("signin") ? (
                            <McpSignInCell
                                endpoint={record}
                                pending={signIn.pendingId !== null}
                                onSignIn={startSignIn}
                            />
                        ) : null}
                        <SettingsRowMenu
                                label={t("settings.mcp.serverActions")}
                                items={[
                                    {
                                        key: "reconnect",
                                        label: t("common.reconnect"),
                                        icon: <ArrowsClockwise size={14} />,
                                        hidden: readOnly,
                                        onClick: () => openReconnect(record),
                                    },
                                    {
                                        key: "view-tools",
                                        label: t("settings.mcp.viewTools"),
                                        icon: <Wrench size={14} />,
                                        hidden: readOnly || !canListTools,
                                        onClick: () => setToolsKey(rowKey(record)),
                                    },
                                    {
                                        key: "rename",
                                        label: t("common.rename"),
                                        icon: <PencilSimpleLine size={14} />,
                                        deferred: true,
                                        hidden: readOnly,
                                        onClick: () => setRenamingKey(rowKey(record)),
                                    },
                                    {
                                        key: "sign-in",
                                        label: t("common.signIn"),
                                        icon: <SignIn size={14} />,
                                        // A phone has no sign-in cell; the menu holds Sign in.
                                        hidden:
                                            shows("signin") ||
                                            !personal ||
                                            !asksForSignIn(record) ||
                                            isSignedIn(record),
                                        disabled: signIn.pendingId !== null,
                                        onClick: () => startSignIn(record),
                                    },
                                    {
                                        key: "sign-out",
                                        label: t("common.signOut"),
                                        icon: <SignOut size={14} />,
                                        // Only a sign-in the person has can be removed.
                                        hidden: !personal || !record.user_sign_in || !asksForSignIn(record),
                                        disabled: signIn.pendingId !== null,
                                        onClick: () => confirmSignOut(record),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "disconnect",
                                        label: t("common.disconnect"),
                                        icon: <LinkBreak size={14} />,
                                        danger: true,
                                        // Only an OAuth grant can be revoked; anything else is a 400.
                                        hidden: readOnly || !hasGrantToRevoke(record),
                                        onClick: () => handleDisconnect(record),
                                    },
                                    {
                                        key: "remove",
                                        label: t("common.remove"),
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: readOnly,
                                        onClick: () => handleRemove(record),
                                    },
                                ]}
                            />
                    </>
                )
            }}
        />
    )

    return (
        <div className="flex flex-col">
            {readOnly ? null : <SettingsPageActions>{connect}</SettingsPageActions>}

            <ConnectionsToolbar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t("settings.mcp.searchServers")}
                filter={
                    <FilterMenu
                        sections={[statusSection]}
                        align="start"
                        size="default"
                        onReset={() => setStatusFilter("all")}
                        resetDisabled={statusFilter === "all"}
                    />
                }
            />
            {signIn.error && !tokenFor ? (
                <p className="m-0 mb-2 text-meta text-destructive">{signIn.error}</p>
            ) : null}
            {projectTable}

            <McpTokenSignInDialog
                open={Boolean(tokenFor)}
                serverName={tokenFor?.name || tokenFor?.slug || t("settings.mcp.thisServer")}
                error={tokenFor && signIn.pendingId === null ? signIn.error : null}
                onSubmit={(token) =>
                    tokenFor ? signIn.signInWithToken(tokenFor, token) : Promise.resolve(false)
                }
                onClose={() => setTokenFor(null)}
            />

            {/* A new journey per attempt: a reconnect chosen while one is open starts over. */}
            <McpConnectJourney
                key={reconnecting?.id ?? "new"}
                open={connecting}
                onClose={closeConnect}
                existingNames={names}
                reconnect={mcpReconnectTarget(reconnecting)}
                onConnected={() => void refresh()}
            />

            {/* "View tools": the project's connection, read-only; a permission belongs to an agent. */}
            {viewingTools?.slug ? (
                <McpServerToolsSheet
                    key={rowKey(viewingTools)}
                    endpoint={viewingTools}
                    onReconnect={() => openReconnect(viewingTools)}
                    onClosed={() => setToolsKey(null)}
                />
            ) : null}

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
