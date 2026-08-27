/**
 * IntegrationPermissionDrawer
 *
 * Sets the permission policy of ONE integration: a default-permission preset, and a per-tool
 * override for any tool that needs its own rule. Adding an integration adds all of its tools, so
 * this drawer is where an author decides what the agent may do with them.
 *
 * It shows what is SAVED. It never resolves `inherit` into `allow` or `ask` — that would mean a
 * second copy of the permission compiler in TypeScript, reading an agent-wide mode this drawer does
 * not own, and the two would drift. The runner is the only place that computes an effective
 * permission.
 *
 * Built for scale: a provider integration can list 50 to 200 tools, so the body carries a search
 * box, two collapsible groups (read-only and write and delete), and a per-group row cap.
 */
import {memo, useMemo, useState} from "react"

import {
    useToolConnectionsQuery,
    useToolIntegrationCatalog,
    useToolIntegrationDetail,
    type ToolCatalogAction,
    type ToolCatalogActionDetails,
} from "@agenta/entities/gatewayTool"
import {HeightCollapse} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Badge, Button, SearchInput, Spinner} from "@agenta/ui/ui"
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

import {humanizeActionKey} from "./itemDescriptors"
import {PolicyGlyph} from "./PermissionGlyph"
import {PermissionPolicySelect} from "./PermissionPolicySelect"

/** Rows rendered per group before the "Show N more" link. */
const GROUP_PAGE_SIZE = 25

// Persisted expand state per integration and group (key = `${integrationKey}:${groupKey}`).
const permissionGroupsExpandedAtom = atomWithStorage<Record<string, boolean>>(
    "agenta:tools:permission-groups-expanded",
    {},
)

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
}

const toolOptions = TOOL_PERMISSION_OPTIONS.map((option) => ({
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
}: {
    tool: CatalogToolInfo
    permission: GatewayPermission
    onChange: (toolKey: string, permission: GatewayPermission) => void
    disabled?: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const [preview, setPreview] = useState<HTMLSpanElement | null>(null)
    const description = tool.description?.trim()
    // Offer "Show more" only when the one-line preview actually cuts the text off. A character
    // count guesses, and guesses both ways at this font size.
    const truncatable = Boolean(preview && preview.scrollWidth > preview.clientWidth)

    return (
        <div
            className={`flex flex-col gap-1 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 first:border-t-0 ${
                expanded ? "bg-[var(--ag-colorFillQuaternary)]" : ""
            }`}
        >
            <div className="flex items-center gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
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
                    {description ? (
                        <span
                            ref={setPreview}
                            className={`text-xs text-[var(--ag-colorTextTertiary)] ${
                                expanded ? "hidden" : "truncate"
                            }`}
                        >
                            {description}
                        </span>
                    ) : null}
                </div>
                <PermissionPolicySelect
                    value={permission}
                    onChange={(value) => onChange(tool.key, value as GatewayPermission)}
                    options={toolOptions}
                    disabled={disabled}
                    size="sm"
                    aria-label={`Permission for ${tool.key}`}
                    triggerClassName={
                        permission === "deny"
                            ? "w-auto shrink-0 border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorErrorText)]"
                            : "w-auto shrink-0"
                    }
                />
            </div>
            {expanded && description ? (
                <span className="text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                    {description}
                </span>
            ) : null}
            {truncatable ? (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="w-fit cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--ag-colorLink)]"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            ) : null}
        </div>
    )
})

/**
 * One collapsible group. Its count and its rollup describe the WHOLE group, not the search result:
 * they say what the integration's read-only or write tools are set to, and a search must not change
 * that answer. Only the rows are filtered.
 */
function ToolGroup({
    label,
    groupKey,
    integrationKey,
    tools,
    search,
    permissions,
    onChangeToolPermission,
    disabled,
}: {
    label: string
    groupKey: string
    integrationKey: string
    tools: CatalogToolInfo[]
    search: string
    permissions: GatewayConnectionPermissions
    onChangeToolPermission: (toolKey: string, permission: GatewayPermission) => void
    disabled?: boolean
}) {
    const [expanded, setExpanded] = useAtom(permissionGroupsExpandedAtom)
    const [shown, setShown] = useState(GROUP_PAGE_SIZE)
    const storageKey = `${integrationKey}:${groupKey}`
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
        return tools.filter((tool) =>
            `${tool.key} ${tool.name ?? ""}`.toLowerCase().includes(search),
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
                <span className="flex-1 text-[12px] font-medium uppercase tracking-wide text-[var(--ag-colorTextSecondary)]">
                    {label} · {tools.length}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--ag-colorTextTertiary)]">
                    {rollup.kind === "shared" ? (
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
                    {visible.map((tool) => (
                        <ToolRow
                            key={tool.key}
                            tool={tool}
                            permission={savedToolPermission(permissions, tool.key)}
                            onChange={onChangeToolPermission}
                            disabled={disabled}
                        />
                    ))}
                    {remaining > 0 ? (
                        <button
                            type="button"
                            onClick={() => setShown((value) => value + GROUP_PAGE_SIZE)}
                            className="cursor-pointer border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-3 py-2 text-left text-xs text-[var(--ag-colorLink)]"
                        >
                            Show {remaining} more
                        </button>
                    ) : null}
                </div>
            </HeightCollapse>
        </div>
    )
}

function DrawerBody({
    target,
    permissions,
    onChangePermissions,
    onChangeToolPermission,
    agentPolicy,
    disabled,
}: Omit<IntegrationPermissionDrawerProps, "open" | "onClose"> & {
    permissions: GatewayConnectionPermissions
}) {
    const [query, setQuery] = useState("")
    // The COMPLETE catalog, as one settled query rather than the paginated browse query: the
    // counts, the read-only partition, and the stale-key list all describe the whole integration,
    // and a partial list misreports every one of them. Search filters client-side for the same
    // reason, and this query carries no shared search atom to fight over.
    const {actions, complete, isLoading, error} = useToolIntegrationCatalog(target.integration)

    // Kept separate from the stale-key pass below: this one walks the whole catalog, and it must
    // not rerun each time a per-tool click gives `permissions` a new identity.
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

    // A saved key is only stale once the whole catalog has been read. Against a half-loaded one
    // every key not yet fetched would look stale.
    const catalogTools = useMemo(
        () => (complete ? withStaleTools(fetchedTools, permissions) : fetchedTools),
        [fetchedTools, permissions, complete],
    )

    const {readOnly, write} = useMemo(() => partitionToolsByAccess(catalogTools), [catalogTools])
    const search = query.trim().toLowerCase()
    const {preset, overrideCount} = readIntegrationPreset(permissions)

    // The count belongs on the selected option, so an author sees how many tools carry their own
    // rule without opening the menu.
    const presetOptions = useMemo(
        () =>
            INTEGRATION_PRESETS.map((def) => {
                // Custom is what a non-empty per-tool map READS BACK as, never something to pick:
                // contracts section 10 gives it no default of its own to write.
                const isCustom = def.value === "custom"
                return {
                    value: def.value,
                    title:
                        isCustom && overrideCount > 0
                            ? `${def.label} · ${overrideCount} overrides`
                            : def.label,
                    help: isCustom ? "Set below, per tool" : def.help,
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

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
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
                    disabled={disabled}
                    aria-label="Default permission"
                />
                {agentPolicyNote ? (
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {agentPolicyNote}
                    </span>
                ) : null}
            </div>

            <SearchInput
                placeholder={`Search ${catalogTools.length} tools`}
                value={query}
                onValueChange={setQuery}
            />

            {isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner size="small" />
                </div>
            ) : error ? (
                // The saved policy is still editable through the preset above; only the per-tool
                // list needs the catalog, so say what is missing rather than showing an empty one.
                <div className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                    Couldn&apos;t load {target.integration}&apos;s tools, so per-tool permissions
                    aren&apos;t listed. The default permission above still applies.
                </div>
            ) : catalogTools.length === 0 ? (
                <div className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                    No tools listed for {target.integration}.
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <ToolGroup
                        label="Read-only"
                        groupKey="read_only"
                        integrationKey={target.integration}
                        tools={readOnly}
                        search={search}
                        permissions={permissions}
                        onChangeToolPermission={onChangeToolPermission}
                        disabled={disabled}
                    />
                    <ToolGroup
                        label="Write and delete"
                        groupKey="write"
                        integrationKey={target.integration}
                        tools={write}
                        search={search}
                        permissions={permissions}
                        onChangeToolPermission={onChangeToolPermission}
                        disabled={disabled}
                    />
                </div>
            )}

            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                Setting a tool&apos;s permission switches the default to Custom.
                {preset === "custom" ? " Picking a preset resets them." : ""}
            </span>
        </div>
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

    return (
        <div className="flex items-center gap-2.5">
            <ProviderLogo logo={integration?.logo ?? null} size={22} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                    {integration?.name || target.integration}
                </span>
                <span className="truncate text-xs font-normal text-[var(--ag-colorTextTertiary)]">
                    Integration · {target.integration}
                    {connectionSlug ? ` · ${connectionSlug} connection` : ""}
                </span>
            </div>
            {/* Shows Pending and Inactive too, which is exactly what an author needs here. */}
            {connection ? (
                <span className="shrink-0 font-normal">
                    <ConnectionStatusBadge connection={connection} />
                </span>
            ) : null}
        </div>
    )
}

export function IntegrationPermissionDrawer({
    open,
    onClose,
    ...body
}: IntegrationPermissionDrawerProps) {
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={480}
            destroyOnClose
            title={<DrawerTitle target={body.target} connectionSlug={body.connectionSlug} />}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <div className="flex items-center justify-end">
                    <Button variant="default" onClick={onClose}>
                        Done
                    </Button>
                </div>
            }
        >
            {body.permissions ? (
                <DrawerBody {...body} permissions={body.permissions} />
            ) : (
                <UnmigratedNotice target={body.target} />
            )}
        </EnhancedDrawer>
    )
}
