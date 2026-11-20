/** The permission list of one source: default permission, tool search, tools by group. Shows what is saved, never resolves `inherit`. */
import {memo, useMemo, useState, type ReactNode} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    useToolConnectionsQuery,
    useToolIntegrationCatalog,
    useToolIntegrationDetail,
    type ToolCatalogAction,
    type ToolCatalogActionDetails,
} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import permissionDrawerCatalog from "@agenta/i18n/catalogs/entityUi.permissionDrawer"
import {humanizeActionKey} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Badge, SearchInput, SkeletonRows} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import ConnectionStatusBadge from "../../../gatewayTool/components/ConnectionStatusBadge"
import {ScrollFadeArea} from "../../../shared/ScrollFadeArea"
import {
    INTEGRATION_PRESETS,
    TOOL_PERMISSION_OPTIONS,
    partitionToolsByAccess,
    presetPermissions,
    readIntegrationPreset,
    rollupGroupPermission,
    rollupLabel,
    shownToolPermission,
    withStaleTools,
    type CatalogToolInfo,
    type IntegrationPreset,
    type PermissionPresetValue,
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

import {ExpandableDescription} from "./ExpandableDescription"
import {PolicyGlyph} from "./PermissionGlyph"
import {PermissionPolicySelect, type PermissionPolicyOption} from "./PermissionPolicySelect"

const tNow = createT(permissionDrawerCatalog)

/** Rows rendered per group before the "Show N more" link. */
const GROUP_PAGE_SIZE = 25

/**
 * Whether one row survives the search. One rule, so the groups and the "nothing matched" message
 * cannot disagree about what matched.
 *
 * Description included: a person hunting "the one that files an issue" knows what a tool does
 * rather than what it is called, and every row here renders its description, so a description match
 * always shows the text it matched on (round 4, D6).
 */
const toolMatchesSearch = (tool: CatalogToolInfo, search: string): boolean =>
    !search ||
    `${tool.key} ${tool.name ?? ""} ${tool.description ?? ""}`.toLowerCase().includes(search)

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

/** One entry in the default-permission menu, before the drawer adds the glyph and the count. */
export interface PermissionPresetOption {
    value: PermissionPresetValue
    label: string
    /** The line under the label in the open menu. */
    help: string
    /** Shown, and shown as the current value, but not pickable: a state reached by setting per-tool
     *  values, or one whose write needs data that has not arrived yet. */
    disabled?: boolean
    /** Draw a divider above this option. */
    separatorBefore?: boolean
}

/**
 * The default-permission presets, for a source whose presets are not the Composio five.
 *
 * MCP needs its own because two of them mean different things there. Its absent policy has a
 * preset of its own, "Follow agent policy", and its "Ask for write and delete" writes an explicit
 * shape the runner honours rather than the absence (decision 45). Reading and writing are the
 * source's, because both need the server's tool annotations, which the drawer does not interpret.
 */
export interface PermissionPresetSource {
    /** Menu order. */
    options: PermissionPresetOption[]
    /** The preset the saved policy reads back as. Ignored while `pending`. */
    value: PermissionPresetValue
    /** Per-tool rules behind it, for the Custom count. */
    overrideCount: number
    onPick: (preset: PermissionPresetValue) => void
    /**
     * The preset whose meaning is "the agent's own permission policy decides", so the note naming
     * that policy is drawn under it. Both tables have one and they are not the same preset, which
     * is why a source names its own.
     */
    agentPolicyPreset?: PermissionPresetValue
    /**
     * The source cannot say which preset this policy is yet, so the select gives way to the
     * loading affordance the list area uses. Naming a preset is making its help line's promise,
     * and a guess held until the data arrives is the promise made on a policy nobody has read.
     */
    pending?: boolean
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
     * The default-permission menu, when the Composio five do not describe this source.
     *
     * A source that brings its own owns its help lines too, so it names the preset the note about
     * the agent's policy is drawn under through `agentPolicyPreset`.
     */
    presets?: PermissionPresetSource
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
    /** What a row says about a saved key the source no longer lists. An MCP server "no longer
     *  offers" a tool, which is the spec's own phrase; a Composio catalog does not list it. */
    staleLabel?: string
    /** With the banner up, everything below it is readable and inert until the login is renewed. */
    controlsDisabled?: boolean
    /** Under the tool list: remediation a row cannot offer on its own. */
    footNote?: ReactNode
    /** The footer's left side, a column so an inline confirm can sit under its own link. */
    footerStart?: ReactNode
    /** Read-only ("View tools"): rows without selects, no footer, no destructive link. */
    readOnly?: boolean
}

/** What the Composio list of one integration needs. */
export interface IntegrationPermissionListProps {
    target: GatewayConnectionTarget
    /** The project connection slug the integration runs under. */
    connectionSlug: string
    permissions: GatewayConnectionPermissions
    /** Write the whole policy (a preset pick). */
    onChangePermissions: (next: GatewayConnectionPermissions) => void
    /** Write one tool's value. Saved even when it equals the default — see contracts section 10. */
    onChangeToolPermission: (toolKey: string, permission: GatewayPermission) => void
    /** The agent-wide `runner.permissions.default`, for the note under the select. */
    agentPolicy?: PermissionPolicy | null
    disabled?: boolean
    /**
     * The "Account" block: whose account the item runs under. Drawn above "Default permission",
     * in the same style. Absent, no account block shows.
     */
    account?: ReactNode
}

/** The Composio five, in the shape a source supplies its own presets in. */
// The texts are getters, so they read the active language when a render reads them.
const defaultPresetOptions: PermissionPresetOption[] = INTEGRATION_PRESETS.map((def) => ({
    value: def.value,
    get label() {
        return def.label
    },
    get help() {
        return def.help
    },
    // Custom is what a non-empty per-tool map READS BACK as, never something to pick: contracts
    // section 10 gives it no default of its own to write.
    disabled: def.value === "custom",
    separatorBefore: def.value === "custom",
}))

const defaultToolOptions: PermissionPolicyOption[] = TOOL_PERMISSION_OPTIONS.map((option) => ({
    value: option.value,
    get title() {
        return option.label
    },
    get help() {
        return option.help
    },
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
    staleLabel,
}: {
    tool: CatalogToolInfo
    permission: GatewayPermission
    onChange: (toolKey: string, permission: GatewayPermission) => void
    disabled?: boolean
    options: PermissionPolicyOption[]
    lockedReason?: string | null
    triggerTitle?: string
    readOnly?: boolean
    staleLabel: string
}) {
    const t = useT(permissionDrawerCatalog)
    // Only the row's tint depends on this; the clamp and the toggle live in ExpandableDescription.
    const [expanded, setExpanded] = useState(false)

    return (
        <div
            className={`flex flex-col border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2.5 transition-colors first:border-t-0 ${
                expanded
                    ? "bg-[var(--ag-colorFillQuaternary)]"
                    : "hover:bg-[var(--ag-colorFillQuaternary)]"
            }`}
        >
            {/* Centred while collapsed; open, the select stays on the name line as the row grows. */}
            <div className={`flex gap-3 ${expanded ? "items-start" : "items-center"}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium leading-5">
                            {tool.name || humanizeActionKey(tool.key)}
                        </span>
                        {tool.stale ? (
                            <Badge
                                variant="outlined"
                                className="m-0 px-1.5 text-[11px] font-normal leading-4"
                            >
                                {staleLabel}
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
                        aria-label={t("entityUi.permissionDrawer.permissionFor", {tool: tool.key})}
                        // A compact 28px chip, so a long list reads as rows, not a column of fields.
                        triggerClassName={`w-auto min-w-[96px] shrink-0 !h-7 !px-2 !text-[13px] sm:min-w-[116px] ${
                            permission === "deny"
                                ? "border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorErrorText)]"
                                : ""
                        }`}
                        // The panel is pinned to the trigger; a compact chip wraps every option label.
                        contentClassName="w-auto min-w-[220px] sm:min-w-[260px]"
                        // Wider than the chip, so it opens leftward with its right edge on the chip's.
                        align="end"
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
    staleLabel,
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
    staleLabel: string
}) {
    const t = useT(permissionDrawerCatalog)
    const [expanded, setExpanded] = useAtom(permissionGroupsExpandedAtom)
    const [shown, setShown] = useState(GROUP_PAGE_SIZE)
    const storageKey = `${catalogKey}:${groupKey}`
    const open = expanded[storageKey] ?? true
    const setOpen = () =>
        setExpanded((prev) => ({...prev, [storageKey]: !(prev[storageKey] ?? true)}))
    const rollup = useMemo(() => rollupGroupPermission(tools, permissions), [tools, permissions])
    const matching = useMemo(
        () => (search ? tools.filter((tool) => toolMatchesSearch(tool, search)) : tools),
        [tools, search],
    )
    if (tools.length === 0) return null
    const visible = matching.slice(0, shown)
    const remaining = matching.length - visible.length

    return (
        <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)]">
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
                            {t("entityUi.permissionDrawer.noMatchesInGroup")}
                        </span>
                    ) : null}
                    {visible.map((tool) => {
                        const shownValue = rowValue?.(tool.key)
                        return (
                            <ToolRow
                                key={tool.key}
                                tool={tool}
                                permission={
                                    shownValue?.value ?? shownToolPermission(permissions, tool)
                                }
                                onChange={onChangeToolPermission}
                                disabled={disabled}
                                options={options}
                                lockedReason={lockedTool?.(tool.key)}
                                triggerTitle={shownValue?.triggerTitle}
                                readOnly={readOnly}
                                staleLabel={staleLabel}
                            />
                        )
                    })}
                    {remaining > 0 ? (
                        <button
                            type="button"
                            onClick={() => setShown((value) => value + GROUP_PAGE_SIZE)}
                            className="cursor-pointer border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-3 py-2 text-left text-xs text-colorInfo"
                        >
                            {t("entityUi.permissionDrawer.showMore", {count: remaining})}
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
export function PermissionDrawerBody({
    catalog,
    catalogKey,
    emptyLabel,
    searchCount,
    permissions,
    onChangePermissions,
    onChangeToolPermission,
    agentPolicy,
    disabled,
    readOnlyLabel,
    writeLabel,
    staleLabel,
    toolOptions = defaultToolOptions,
    presets,
    lockedTool,
    rowValue,
    banner,
    controlsDisabled,
    footNote,
    readOnly,
    account,
    flush = false,
}: {
    /** Embedded under a host's own header and gutter: no outer padding of its own. */
    flush?: boolean
    /** The "Account" block, above "Default permission". */
    account?: ReactNode
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
    const t = useT(permissionDrawerCatalog)
    const stale = staleLabel ?? t("entityUi.permissionDrawer.notInCatalog")
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
    const saved = readIntegrationPreset(permissions)
    // A source with its own presets reads and writes them itself: both need the server's tool
    // annotations, which this drawer lists but does not interpret.
    const preset = presets?.value ?? saved.preset
    const overrideCount = presets?.overrideCount ?? saved.overrideCount
    const presetList = presets?.options ?? defaultPresetOptions

    // The count belongs on the selected option, so an author sees how many tools carry their own
    // rule without opening the menu.
    const presetOptions = useMemo(
        () =>
            presetList.map((def) => ({
                value: def.value,
                // Custom's help line is the table's, like every other preset's: the table already
                // carries the spec's own sentence for it, and a second one written here said the
                // same thing in different words.
                title:
                    def.value === "custom" && overrideCount > 0
                        ? tNow("entityUi.permissionDrawer.presetWithOverrides", {
                              label: def.label,
                              count: overrideCount,
                          })
                        : def.label,
                help: def.help,
                icon: <PolicyGlyph value={def.value} size={14} />,
                separatorBefore: def.separatorBefore,
                disabled: def.disabled,
            })),
        [presetList, overrideCount],
    )

    // "Follow agent policy" leans on the agent-wide mode entirely, so the note names that mode
    // when it is not the default. "Ask for write and delete" writes what it says in both sources
    // and needs no qualifying (decision 45).
    const notePreset = presets ? presets.agentPolicyPreset : "follow_agent"
    const agentPolicyNote =
        notePreset &&
        preset === notePreset &&
        agentPolicy &&
        agentPolicy !== DEFAULT_PERMISSION_POLICY
            ? t("entityUi.permissionDrawer.agentPolicyNote", {
                  policy: permissionPolicyLabel(agentPolicy)?.toLowerCase() ?? agentPolicy,
              })
            : null

    const inert = disabled || controlsDisabled
    // The server has tools; this query names none of them.
    const noMatches =
        search.length > 0 && !catalogTools.some((tool) => toolMatchesSearch(tool, search))

    return (
        // Stable gutter: expanding a row must not summon a scrollbar that shifts every control left.
        <ScrollFadeArea
            className={`flex min-h-0 flex-1 flex-col gap-3.5 [scrollbar-gutter:stable] ${
                // -mx/px: the field rings keep 4px clear of the scroll clip.
                flush ? "-mx-1 px-1 pb-1 pt-4" : "p-4"
            }`}
        >
            {banner}

            {/* One wrapper, so "everything under the banner is inert" reads as one block rather
                than as a dozen separately greyed controls. */}
            <div
                className={`flex min-h-0 flex-1 flex-col gap-3.5 ${
                    controlsDisabled ? "opacity-45" : ""
                }`}
            >
                {readOnly ? null : account}

                {readOnly ? null : (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                            {t("entityUi.permissionDrawer.defaultPermission")}
                        </span>
                        {presets?.pending ? (
                            // One bar at the select's own height, so the row keeps its shape while
                            // the answer is on the way. Decorative, like the list's rows.
                            <SkeletonRows count={1} rowClassName="h-9" />
                        ) : (
                            <PermissionPolicySelect
                                value={preset}
                                onChange={(value) =>
                                    presets
                                        ? presets.onPick(value as PermissionPresetValue)
                                        : onChangePermissions(
                                              presetPermissions(
                                                  value as IntegrationPreset,
                                                  permissions,
                                              ),
                                          )
                                }
                                options={presetOptions}
                                disabled={inert}
                                aria-label={t("entityUi.permissionDrawer.defaultPermission")}
                            />
                        )}
                        {agentPolicyNote ? (
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                {agentPolicyNote}
                            </span>
                        ) : null}
                    </div>
                )}

                {/* Hidden when there are no tools to search, e.g. a list that failed to load. */}
                {catalogTools.length > 0 || (searchCount ?? 0) > 0 ? (
                    <SearchInput
                        // A plural key, because a one-tool server read "Search 1 tools".
                        placeholder={t("entityUi.permissionDrawer.searchToolCount", {
                            count: searchCount ?? catalogTools.length,
                        })}
                        aria-label={t("entityUi.permissionDrawer.searchTools")}
                        value={query}
                        onValueChange={setQuery}
                        disabled={inert}
                    />
                ) : null}

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
                ) : noMatches ? (
                    // Said in place of the groups, headers and all: two empty groups under their
                    // own counts read as a server that stopped advertising its tools, which is a
                    // different answer from "this query does not name any of them". Same sentence
                    // the connection detail drawer's tool filter uses.
                    <div className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                        {t("entityUi.permissionDrawer.noToolMatches")}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <ToolGroup
                            label={readOnlyLabel ?? t("entityUi.permissionDrawer.readOnlyGroup")}
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
                            staleLabel={stale}
                        />
                        <ToolGroup
                            label={writeLabel ?? t("entityUi.permissionDrawer.writeGroup")}
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
                            staleLabel={stale}
                        />
                    </div>
                )}

                {footNote}

                {readOnly ? null : (
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {t("entityUi.permissionDrawer.customSwitchNote")}
                        {preset === "custom"
                            ? ` ${t("entityUi.permissionDrawer.presetResetsNote")}`
                            : ""}
                    </span>
                )}
            </div>
        </ScrollFadeArea>
    )
}

/** The Composio body: reads the catalog hook, then renders the shared body. */
export function IntegrationDrawerBody({
    target,
    permissions,
    ...rest
}: IntegrationPermissionListProps) {
    const t = useT(permissionDrawerCatalog)
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
                    {tNow("entityUi.permissionDrawer.toolsNotLoaded", {
                        integration: target.integration,
                    })}
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
            emptyLabel={t("entityUi.permissionDrawer.noToolsListed", {
                integration: target.integration,
            })}
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
export function UnmigratedNotice({target}: {target: GatewayConnectionTarget}) {
    const t = useT(permissionDrawerCatalog)
    return (
        <div className="flex flex-col gap-2 p-4 text-xs text-[var(--ag-colorTextSecondary)]">
            <span className="text-sm font-medium">{t("entityUi.permissionDrawer.oldFormat")}</span>
            <span>
                {t("entityUi.permissionDrawer.oldFormatDetail", {
                    integration: target.integration,
                })}
            </span>
            <span>{t("entityUi.permissionDrawer.oldFormatKeepRunning")}</span>
        </div>
    )
}

/** Header: logo, name and connection; a state tag only when something needs attention. */
export function IntegrationTitle({
    target,
    connectionSlug,
    notConnected,
}: {
    target: GatewayConnectionTarget
    connectionSlug: string
    /** Each person's own account, and the viewer has none. */
    notConnected?: boolean
}) {
    const tCommon = useT(commonCatalog)
    const {integration} = useToolIntegrationDetail(target.integration)
    const {connections} = useToolConnectionsQuery()
    const connection = findTargetConnection(connections, target, connectionSlug)
    const displayName = integration?.name || target.integration
    const showSlug = displayName.toLowerCase() !== target.integration.toLowerCase()
    // A healthy connection shows no tag (decided on 19 November).
    const healthy = connection && isConnectionActive(connection) && isConnectionValid(connection)

    return (
        // w-full + min-w-0: the title slot will not shrink alone, pushing the badge past the edge.
        <div className="flex w-full min-w-0 items-center gap-2.5">
            <ProviderLogo
                logo={integration?.logo ?? null}
                size={22}
                className="max-sm:!size-[18px]"
            />
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
            {notConnected ? (
                <span className="shrink-0 text-xs font-normal">
                    <StatusIndicator tone="default" label={tCommon("common.notConnected")} />
                </span>
            ) : connection && !healthy ? (
                <span className="shrink-0 text-xs font-normal">
                    <ConnectionStatusBadge connection={connection} />
                </span>
            ) : null}
        </div>
    )
}
