/**
 * IntegrationPermissionDrawer
 *
 * Sets the permission policy of ONE connected source: a default-permission preset, and a per-tool
 * override for any tool that needs its own rule. Adding a source adds all of its tools, so this
 * drawer is where an author decides what the agent may do with them.
 *
 * It shows what is SAVED. It never resolves `inherit` into `allow` or `ask` — that would mean a
 * second copy of the permission compiler in TypeScript, reading an agent-wide mode this drawer does
 * not own, and the two would drift. The runner is the only place that computes an effective
 * permission.
 *
 * Built for scale: a provider integration can list 50 to 200 tools, so the body carries a search
 * box, two collapsible groups (read-only and write and delete), and a per-group row cap.
 *
 * TWO SOURCES, ONE DRAWER. Without a `source` prop the drawer reads a Composio integration from the
 * catalog hook, which is what it has always done. With one, the caller supplies the header, the
 * catalog, and the footer extras, and an MCP connection renders through the same body. The seam is
 * data, not markup: everything a source hands over is either already-resolved catalog state or a
 * node, so neither caller can reshape the other's rows.
 */
import {memo, useMemo, useState, type ReactNode} from "react"

import {
    useToolConnectionsQuery,
    useToolIntegrationCatalog,
    useToolIntegrationDetail,
    type ToolCatalogAction,
    type ToolCatalogActionDetails,
} from "@agenta/entities/gatewayTool"
import {humanizeActionKey} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Badge, Button, SearchInput, SkeletonRows} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import ConnectionStatusBadge from "../../../gatewayTool/components/ConnectionStatusBadge"
import {
    INTEGRATION_PRESETS,
    TOOL_PERMISSION_OPTIONS,
    partitionToolsByAccess,
    presetPermissions,
    readIntegrationPreset,
    rollupGroupPermission,
    rollupLabel,
    savedToolPermission,
    withStaleTools,
    type CatalogToolInfo,
    type IntegrationPreset,
} from "../integrationPolicy"
import {
    permissionPolicyLabel,
    DEFAULT_PERMISSION_POLICY,
    type PermissionPolicy,
} from "../permissionPolicy"
import {ProviderLogo} from "../sectionGroups"
import {findTargetConnection} from "../toolUtils"
import type {
    GatewayConnectionPermissions,
    GatewayConnectionTarget,
    GatewayPermission,
} from "../toolUtils"

import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"
import {ExpandableDescription} from "./ExpandableDescription"
import {PolicyGlyph} from "./PermissionGlyph"
import {PermissionPolicySelect, type PermissionPolicyOption} from "./PermissionPolicySelect"

/** Rows rendered per group before the "Show N more" link. */
const GROUP_PAGE_SIZE = 25

// Persisted expand state per source and group (key = `${catalogKey}:${groupKey}`).
const permissionGroupsExpandedAtom = atomWithStorage<Record<string, boolean>>(
    "agenta:tools:permission-groups-expanded",
    {},
)

/** What one row's control shows, where the saved default is not the whole answer. */
export interface PermissionRowValue {
    value: GatewayPermission
    /** What the TRIGGER says, where the menu's name for that value is not the whole truth. */
    triggerTitle?: string
}

/** The catalog a source hands the drawer, already fetched and already in the drawer's shape. */
export interface PermissionDrawerCatalog {
    status: "loading" | "error" | "ready"
    tools: CatalogToolInfo[]
    /**
     * Whether the WHOLE catalog has been read. A saved key may only be called stale against a
     * complete one, or every key not yet fetched would be accused of having left the server.
     */
    complete: boolean
    /** Shown in place of the list while `status` is "error". The source owns the wording and the
     *  action, because what fixes a failure differs per source. */
    errorNode?: ReactNode
}

/**
 * Everything a non-Composio source has to supply. Absent, the drawer reads the Composio catalog
 * hook and renders the integration header, which is its original behaviour.
 */
export interface PermissionDrawerSource {
    /** Identity for the per-group expand memory and for the group keys. */
    catalogKey: string
    /** The header, in place of the provider logo, name and connection badge. */
    title: ReactNode
    catalog: PermissionDrawerCatalog
    /** What an empty but successfully read catalog says. */
    emptyLabel: string
    /** The number in the search placeholder, when the catalog on screen is not the whole truth —
     *  a lapsed login leaves a cached count and no list to count. Defaults to the rows shown. */
    searchCount?: number
    /** Group headers. Defaults to the Composio wording. */
    readOnlyLabel?: string
    writeLabel?: string
    /** The per-tool menu, when a source needs its own labels. Defaults to the four shared values. */
    toolOptions?: PermissionPolicyOption[]
    /**
     * Why this tool may not be given a permission, or null when it may. A locked row shows the
     * reason where its description would be and its control is disabled: the MCP API refuses a
     * whole policy that names a filter-hidden tool, so offering the control would build a config
     * that fails on every run rather than once at save (CR18).
     */
    lockedTool?: (toolKey: string) => string | null
    /**
     * What one row's control shows.
     *
     * An MCP tool with no entry of its own carries no value at all: the row reads `inherit` and its
     * trigger says what the run resolves that to, so a bare permission never appears without its
     * provenance. Absent, a row shows the saved value, which is the Composio rule.
     */
    rowValue?: (toolKey: string) => PermissionRowValue | undefined
    /** Above the controls: the login-expired banner (D4). */
    banner?: ReactNode
    /** With the banner up, everything below it is readable and inert until the login is renewed. */
    controlsDisabled?: boolean
    /** Under the tool list: remediation a row cannot offer on its own. */
    footNote?: ReactNode
    /** The footer's left side, a column so an inline confirm can sit under its own link. */
    footerStart?: ReactNode
    /** Read-only ("View tools"): rows without selects, no footer, no destructive link. */
    readOnly?: boolean
}

export interface IntegrationPermissionDrawerProps {
    open: boolean
    onClose: () => void
    target: GatewayConnectionTarget
    /** The project connection slug the integration runs under. */
    connectionSlug: string
    /** Null when the integration has no connection entry — its legacy entries span two connections
     *  and could not be converted, so there is no single policy to edit. */
    permissions: GatewayConnectionPermissions | null
    /** Write the whole policy (a preset pick). */
    onChangePermissions: (next: GatewayConnectionPermissions) => void
    /** Write one tool's value. Saved even when it equals the default — see contracts section 10. */
    onChangeToolPermission: (toolKey: string, permission: GatewayPermission) => void
    /** The agent-wide `runner.permissions.default`, for the note under the select. */
    agentPolicy?: PermissionPolicy | null
    disabled?: boolean
    /** Renders a non-Composio source through the same body. */
    source?: PermissionDrawerSource
}

const defaultToolOptions: PermissionPolicyOption[] = TOOL_PERMISSION_OPTIONS.map((option) => ({
    value: option.value,
    title: option.label,
    help: option.help,
    icon: <PolicyGlyph value={option.value} size={14} />,
}))

// Memoized, and given a handler that does not change per render: a group renders up to 25 of these,
// each holding a Select, and the drawer re-renders on every keystroke in its search box and on
// every catalog page that lands.
const ToolRow = memo(function ToolRow({
    tool,
    permission,
    onChange,
    disabled,
    options,
    lockedReason,
    triggerTitle,
    readOnly,
}: {
    tool: CatalogToolInfo
    permission: GatewayPermission
    onChange: (toolKey: string, permission: GatewayPermission) => void
    disabled?: boolean
    options: PermissionPolicyOption[]
    lockedReason?: string | null
    triggerTitle?: string
    readOnly?: boolean
}) {
    // Only the row's tint depends on this; the clamp and the toggle live in ExpandableDescription.
    const [expanded, setExpanded] = useState(false)

    return (
        <div
            className={`flex flex-col gap-1 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 first:border-t-0 ${
                expanded ? "bg-[var(--ag-colorFillQuaternary)]" : ""
            }`}
        >
            {/* items-start, not items-center: the select must stay put while the row grows. */}
            <div className="flex items-start gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* Matches the select's h-control so the name line stays level with it. */}
                    <div className="flex min-h-[28px] items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">
                            {tool.name || humanizeActionKey(tool.key)}
                        </span>
                        {tool.stale ? (
                            <Badge
                                variant="outlined"
                                className="m-0 px-1.5 text-[11px] font-normal leading-4"
                            >
                                not in catalog
                            </Badge>
                        ) : null}
                    </div>
                    {lockedReason ? (
                        <span className="text-xs text-colorTextTertiary">{lockedReason}</span>
                    ) : (
                        <ExpandableDescription
                            description={tool.description}
                            label={tool.name || humanizeActionKey(tool.key)}
                            onExpandedChange={setExpanded}
                        />
                    )}
                </div>
                {readOnly ? null : (
                    <PermissionPolicySelect
                        value={permission}
                        onChange={(value) => onChange(tool.key, value as GatewayPermission)}
                        options={options}
                        disabled={disabled || Boolean(lockedReason)}
                        size="sm"
                        triggerTitle={triggerTitle}
                        aria-label={`Permission for ${tool.key}`}
                        // Narrower and smaller-set on a phone, so the tool name beside it stays legible.
                        triggerClassName={
                            permission === "deny"
                                ? "w-auto min-w-[104px] shrink-0 border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorErrorText)] max-sm:!text-field-sm sm:min-w-[132px]"
                                : "w-auto min-w-[104px] shrink-0 max-sm:!text-field-sm sm:min-w-[132px]"
                        }
                        // The panel is pinned to the trigger; a compact chip wraps every option label.
                        contentClassName="w-auto min-w-[220px] sm:min-w-[260px]"
                    />
                )}
            </div>
        </div>
    )
})

/**
 * One collapsible group. Its count and its rollup describe the WHOLE group, not the search result:
 * they say what the source's read-only or write tools are set to, and a search must not change that
 * answer. Only the rows are filtered.
 */
function ToolGroup({
    label,
    groupKey,
    catalogKey,
    tools,
    search,
    permissions,
    onChangeToolPermission,
    disabled,
    options,
    lockedTool,
    rowValue,
    readOnly,
}: {
    label: string
    groupKey: string
    catalogKey: string
    tools: CatalogToolInfo[]
    search: string
    permissions: GatewayConnectionPermissions
    onChangeToolPermission: (toolKey: string, permission: GatewayPermission) => void
    disabled?: boolean
    options: PermissionPolicyOption[]
    lockedTool?: (toolKey: string) => string | null
    rowValue?: (toolKey: string) => PermissionRowValue | undefined
    readOnly?: boolean
}) {
    const [expanded, setExpanded] = useAtom(permissionGroupsExpandedAtom)
    const [shown, setShown] = useState(GROUP_PAGE_SIZE)
    const storageKey = `${catalogKey}:${groupKey}`
    const open = expanded[storageKey] ?? true
    const setOpen = () =>
        setExpanded((prev) => ({...prev, [storageKey]: !(prev[storageKey] ?? true)}))
    const rollup = useMemo(
        () =>
            rollupGroupPermission(
                tools.map((tool) => tool.key),
                permissions,
            ),
        [tools, permissions],
    )
    const matching = useMemo(() => {
        if (!search) return tools
        // Description included: a person hunting "the one that files an issue" knows what a tool
        // does rather than what it is called, and every row here renders its description, so a
        // description match always shows the text it matched on (round 4, D6).
        return tools.filter((tool) =>
            `${tool.key} ${tool.name ?? ""} ${tool.description ?? ""}`
                .toLowerCase()
                .includes(search),
        )
    }, [tools, search])
    if (tools.length === 0) return null
    const visible = matching.slice(0, shown)
    const remaining = matching.length - visible.length

    return (
        <div className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)]">
            <div
                onClick={setOpen}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setOpen()
                    }
                }}
                className="flex cursor-pointer items-center gap-2 bg-[var(--ag-colorFillQuaternary)] px-3 py-2 transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
            >
                {open ? (
                    <CaretDown size={11} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                ) : (
                    <CaretRight
                        size={11}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                )}
                {/* Sentence case, not the board's uppercase: the house style wins over the spec's
                    typography, and "Read-only · 22" is how every other count reads in the app. */}
                <span className="flex-1 text-[12px] font-medium tracking-wide text-[var(--ag-colorTextSecondary)]">
                    {label} · {tools.length}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--ag-colorTextTertiary)]">
                    {/* Only "runs automatically" carries a glyph, as the board draws it. The other
                        four rollups are plain text. */}
                    {rollup.kind === "shared" && rollup.permission === "allow" ? (
                        <PolicyGlyph value={rollup.permission} size={12} />
                    ) : null}
                    {rollupLabel(rollup)}
                </span>
            </div>
            <HeightCollapse open={open}>
                <div className="flex flex-col">
                    {search && matching.length === 0 ? (
                        <span className="px-3 py-2 text-xs text-[var(--ag-colorTextTertiary)]">
                            No matches in this group.
                        </span>
                    ) : null}
                    {visible.map((tool) => {
                        const shownValue = rowValue?.(tool.key)
                        return (
                            <ToolRow
                                key={tool.key}
                                tool={tool}
                                permission={
                                    shownValue?.value ?? savedToolPermission(permissions, tool.key)
                                }
                                onChange={onChangeToolPermission}
                                disabled={disabled}
                                options={options}
                                lockedReason={lockedTool?.(tool.key)}
                                triggerTitle={shownValue?.triggerTitle}
                                readOnly={readOnly}
                            />
                        )
                    })}
                    {remaining > 0 ? (
                        <button
                            type="button"
                            onClick={() => setShown((value) => value + GROUP_PAGE_SIZE)}
                            className="cursor-pointer border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-3 py-2 text-left text-xs text-colorInfo"
                        >
                            Show {remaining} more
                        </button>
                    ) : null}
                </div>
            </HeightCollapse>
        </div>
    )
}

/**
 * The body, once somebody has produced a catalog. Pure in the catalog: it fetches nothing, so the
 * Composio hook and an MCP tool-list request never both fire for one open drawer.
 */
function PermissionDrawerBody({
    catalog,
    catalogKey,
    emptyLabel,
    searchCount,
    permissions,
    onChangePermissions,
    onChangeToolPermission,
    agentPolicy,
    disabled,
    readOnlyLabel = "Read-only",
    writeLabel = "Write and delete",
    toolOptions = defaultToolOptions,
    lockedTool,
    rowValue,
    banner,
    controlsDisabled,
    footNote,
    readOnly,
}: {
    catalog: PermissionDrawerCatalog
    catalogKey: string
    emptyLabel: string
    permissions: GatewayConnectionPermissions
    onChangePermissions: (next: GatewayConnectionPermissions) => void
    onChangeToolPermission: (toolKey: string, permission: GatewayPermission) => void
    agentPolicy?: PermissionPolicy | null
    disabled?: boolean
} & Omit<
    PermissionDrawerSource,
    "catalog" | "catalogKey" | "emptyLabel" | "title" | "footerStart"
>) {
    const [query, setQuery] = useState("")

    // A saved key is only stale once the whole catalog has been read. Against a half-loaded one
    // every key not yet fetched would look stale.
    const catalogTools = useMemo(
        () => (catalog.complete ? withStaleTools(catalog.tools, permissions) : catalog.tools),
        [catalog.tools, catalog.complete, permissions],
    )

    const {readOnly: readOnlyTools, write} = useMemo(
        () => partitionToolsByAccess(catalogTools),
        [catalogTools],
    )
    const search = query.trim().toLowerCase()
    const {preset, overrideCount} = readIntegrationPreset(permissions)

    // The count belongs on the selected option, so an author sees how many tools carry their own
    // rule without opening the menu.
    const presetOptions = useMemo(
        () =>
            INTEGRATION_PRESETS.map((def) => {
                // Custom is what a non-empty per-tool map READS BACK as, never something to pick:
                // contracts section 10 gives it no default of its own to write. Its help line is
                // the table's, like every other preset's: the table already carries the spec's own
                // sentence for it, and a second one written here said the same thing in different
                // words.
                const isCustom = def.value === "custom"
                return {
                    value: def.value,
                    title:
                        isCustom && overrideCount > 0
                            ? `${def.label} · ${overrideCount} ${
                                  overrideCount === 1 ? "override" : "overrides"
                              }`
                            : def.label,
                    help: def.help,
                    icon: <PolicyGlyph value={def.value} size={14} />,
                    separatorBefore: isCustom,
                    disabled: isCustom,
                }
            }),
        [overrideCount],
    )

    // Open question 1: the preset saves `inherit`, which means "reads run, writes ask" only while
    // the agent-wide mode is its default. Say so rather than letting the words quietly change.
    const agentPolicyNote =
        preset === "ask_writes" && agentPolicy && agentPolicy !== DEFAULT_PERMISSION_POLICY
            ? `This agent's permission policy is set to ${
                  permissionPolicyLabel(agentPolicy)?.toLowerCase() ?? agentPolicy
              }, so these tools follow it.`
            : null

    const inert = disabled || controlsDisabled

    return (
        // Stable gutter: expanding a row must not summon a scrollbar that shifts every control left.
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 [scrollbar-gutter:stable]">
            {banner}

            {/* One wrapper, so "everything under the banner is inert" reads as one block rather
                than as a dozen separately greyed controls. */}
            <div
                className={`flex min-h-0 flex-1 flex-col gap-3.5 ${
                    controlsDisabled ? "opacity-45" : ""
                }`}
            >
                {readOnly ? null : (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                            Default permission
                        </span>
                        <PermissionPolicySelect
                            value={preset}
                            onChange={(value) =>
                                onChangePermissions(
                                    presetPermissions(value as IntegrationPreset, permissions),
                                )
                            }
                            options={presetOptions}
                            disabled={inert}
                            aria-label="Default permission"
                        />
                        {agentPolicyNote ? (
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                {agentPolicyNote}
                            </span>
                        ) : null}
                    </div>
                )}

                <SearchInput
                    placeholder={`Search ${searchCount ?? catalogTools.length} tools`}
                    aria-label="Search tools"
                    value={query}
                    onValueChange={setQuery}
                    disabled={inert}
                />

                {catalog.status === "loading" ? (
                    // Three rows at a tool row's own height, so the list area keeps its shape
                    // while the answer is on the way (decision 25).
                    <SkeletonRows
                        className="rounded border border-solid border-colorBorderSecondary p-3"
                        rowClassName="h-9"
                    />
                ) : catalog.status === "error" ? (
                    // The saved policy is still editable through the preset above; only the
                    // per-tool list needs the catalog, so say what is missing rather than showing
                    // an empty one.
                    catalog.errorNode
                ) : catalogTools.length === 0 ? (
                    <div className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                        {emptyLabel}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <ToolGroup
                            label={readOnlyLabel}
                            groupKey="read_only"
                            catalogKey={catalogKey}
                            tools={readOnlyTools}
                            search={search}
                            permissions={permissions}
                            onChangeToolPermission={onChangeToolPermission}
                            disabled={inert}
                            options={toolOptions}
                            lockedTool={lockedTool}
                            rowValue={rowValue}
                            readOnly={readOnly}
                        />
                        <ToolGroup
                            label={writeLabel}
                            groupKey="write"
                            catalogKey={catalogKey}
                            tools={write}
                            search={search}
                            permissions={permissions}
                            onChangeToolPermission={onChangeToolPermission}
                            disabled={inert}
                            options={toolOptions}
                            lockedTool={lockedTool}
                            rowValue={rowValue}
                            readOnly={readOnly}
                        />
                    </div>
                )}

                {footNote}

                {readOnly ? null : (
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        Setting a tool&apos;s permission switches the default to Custom.
                        {preset === "custom" ? " Picking a preset resets them." : ""}
                    </span>
                )}
            </div>
        </div>
    )
}

/** The Composio body: reads the catalog hook, then renders the shared body. */
function IntegrationDrawerBody({
    target,
    permissions,
    ...rest
}: Omit<IntegrationPermissionDrawerProps, "open" | "onClose" | "source"> & {
    permissions: GatewayConnectionPermissions
}) {
    // The COMPLETE catalog, as one settled query rather than the paginated browse query: the
    // counts, the read-only partition, and the stale-key list all describe the whole integration,
    // and a partial list misreports every one of them. Search filters client-side for the same
    // reason, and this query carries no shared search atom to fight over.
    const {actions, complete, isLoading, error} = useToolIntegrationCatalog(target.integration)

    // Kept separate from the stale-key pass in the body: this one walks the whole catalog, and it
    // must not rerun each time a per-tool click gives `permissions` a new identity.
    const fetchedTools = useMemo<CatalogToolInfo[]>(() => {
        const seen = new Set<string>()
        const tools: CatalogToolInfo[] = []
        for (const action of actions as (ToolCatalogAction | ToolCatalogActionDetails)[]) {
            if (!action.key || seen.has(action.key)) continue
            seen.add(action.key)
            tools.push({
                key: action.key,
                name: action.name ?? undefined,
                description: action.description ?? undefined,
                readOnly: action.read_only ?? undefined,
            })
        }
        return tools
    }, [actions])

    const catalog = useMemo<PermissionDrawerCatalog>(
        () => ({
            status: isLoading ? "loading" : error ? "error" : "ready",
            tools: fetchedTools,
            complete,
            errorNode: (
                <div className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                    Couldn&apos;t load {target.integration}&apos;s tools, so per-tool permissions
                    aren&apos;t listed. The default permission above still applies.
                </div>
            ),
        }),
        [complete, error, fetchedTools, isLoading, target.integration],
    )

    return (
        <PermissionDrawerBody
            {...rest}
            catalog={catalog}
            catalogKey={target.integration}
            emptyLabel={`No tools listed for ${target.integration}.`}
            permissions={permissions}
        />
    )
}

/**
 * An integration whose legacy entries name two or more connections. It is deliberately left
 * unconverted: grouping those entries by connection would give one integration two entries, which
 * the saved format rejects, and picking one connection would guess the author's intent and drop the
 * tools of the other. The entries keep working exactly as they are.
 */
function UnmigratedNotice({target}: {target: GatewayConnectionTarget}) {
    return (
        <div className="flex flex-col gap-2 p-4 text-xs text-[var(--ag-colorTextSecondary)]">
            <span className="text-sm font-medium">This integration uses the old format</span>
            <span>
                Its tools are saved one at a time across more than one connection, so they cannot be
                converted into a single {target.integration} policy automatically.
            </span>
            <span>
                They keep running as they are. To set permissions here, remove the integration and
                add it again under one connection.
            </span>
        </div>
    )
}

/** Header: logo, name, the integration and connection it points at, and its connection state. */
function DrawerTitle({
    target,
    connectionSlug,
}: {
    target: GatewayConnectionTarget
    connectionSlug: string
}) {
    const {integration} = useToolIntegrationDetail(target.integration)
    const {connections} = useToolConnectionsQuery()
    const connection = findTargetConnection(connections, target, connectionSlug)
    const displayName = integration?.name || target.integration
    const showSlug = displayName.toLowerCase() !== target.integration.toLowerCase()

    return (
        // w-full + min-w-0: the title slot will not shrink alone, pushing the badge past the edge.
        <div className="flex w-full min-w-0 items-center gap-2.5">
            <ProviderLogo
                logo={integration?.logo ?? null}
                size={22}
                className="max-sm:!size-[18px]"
            />
            {/* One line: "Integration · gmail · gmail-main connection" repeated the name and
                labelled what the logo already says. The slug is dropped where the name IS it. */}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate text-sm font-semibold">{displayName}</span>
                {showSlug ? (
                    // Dropped on a phone: it never shrinks, so it cut the name down to one letter.
                    <span className="hidden shrink-0 text-xs font-normal text-[var(--ag-colorTextTertiary)] sm:inline">
                        {target.integration}
                    </span>
                ) : null}
                {connectionSlug ? (
                    <span className="min-w-0 truncate text-xs font-normal text-[var(--ag-colorTextTertiary)]">
                        {connectionSlug}
                    </span>
                ) : null}
            </div>
            {/* Shows Pending and Inactive too, which is exactly what an author needs here. */}
            {connection ? (
                // text-xs: the drawer title is 16px, and every other meta label here is 12px.
                <span className="shrink-0 text-xs font-normal">
                    <ConnectionStatusBadge connection={connection} />
                </span>
            ) : null}
        </div>
    )
}

export function IntegrationPermissionDrawer({
    open,
    onClose,
    source,
    ...body
}: IntegrationPermissionDrawerProps) {
    const readOnly = source?.readOnly ?? false

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            // A bottom sheet below lg and the app's right-edge drawer above it, which is what makes
            // one component correct in both apps rather than a desktop panel squeezed onto a phone.
            placement="responsive"
            width={INTEGRATION_DRAWER_WIDTH}
            destroyOnClose
            title={
                source?.title ?? (
                    <DrawerTitle target={body.target} connectionSlug={body.connectionSlug} />
                )
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                readOnly ? undefined : (
                    // items-end, not items-center: the left column grows downward when an inline
                    // confirm opens under its link, and Done stays on the bottom line with it.
                    <div className="flex items-end justify-between gap-2">
                        <div className="flex min-w-0 flex-col items-start gap-2">
                            {source?.footerStart}
                        </div>
                        <Button variant="default" onClick={onClose}>
                            Done
                        </Button>
                    </div>
                )
            }
        >
            {!body.permissions ? (
                <UnmigratedNotice target={body.target} />
            ) : source ? (
                <PermissionDrawerBody
                    {...body}
                    permissions={body.permissions}
                    catalog={source.catalog}
                    catalogKey={source.catalogKey}
                    emptyLabel={source.emptyLabel}
                    searchCount={source.searchCount}
                    readOnlyLabel={source.readOnlyLabel}
                    writeLabel={source.writeLabel}
                    toolOptions={source.toolOptions}
                    lockedTool={source.lockedTool}
                    rowValue={source.rowValue}
                    banner={source.banner}
                    controlsDisabled={source.controlsDisabled}
                    footNote={source.footNote}
                    readOnly={source.readOnly}
                />
            ) : (
                <IntegrationDrawerBody {...body} permissions={body.permissions} />
            )}
        </EnhancedDrawer>
    )
}
