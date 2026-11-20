/** The Integrations and Subagents section bodies, both read off the flat `tools` array. Function
 *  tool definitions and provider built-ins are deliberately not rendered: they still run. */
import {type CSSProperties, type ReactNode, useMemo} from "react"

import {USER_ACCOUNT_SOURCE} from "@agenta/entities/accountChoice"
import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import accountSwitchCatalog from "@agenta/i18n/catalogs/entityUi.accountSwitch"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import integrationsPhoneCatalog from "@agenta/i18n/catalogs/entityUi.integrationsPhone"
import itemDescriptorsCatalog from "@agenta/i18n/catalogs/entityUi.itemDescriptors"
import {humanizeActionKey} from "@agenta/shared/utils"
import {CaretRight} from "@phosphor-icons/react"

import {ProviderLogo} from "../sectionGroups"
import {integrationRowIndices, isHarnessBuiltinTool, type IntegrationRow} from "../toolUtils"

import {
    describeSubagent,
    isReferenceTool,
    toolReferenceSlug,
    type ItemDescriptor,
} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {ItemRow, StatusTag, type ItemRowStatus, type ItemRowStatusTone} from "./ItemRow"
import {usePhoneSections} from "./phoneSections"

const tNow = createT(configItemsCatalog, itemDescriptorsCatalog)

/** Per-tool draft/validation status, keyed by the tool's index in the flat `tools` array. */
type ToolStatusFor = (item: unknown, index: number) => ItemRowStatus | undefined

interface IndexedTool {
    item: unknown
    index: number
}

// Blocking problems outrank draft markers, mirroring the section-header rollup.
const STATUS_TONE_PRIORITY: Record<ItemRowStatusTone, number> = {
    invalid: 0,
    incomplete: 1,
    edited: 2,
    new: 3,
}

/** The worst status among an integration's entries, so one row still points at the problem. */
function rollupRowStatus(
    tools: unknown[],
    indices: number[],
    statusFor?: ToolStatusFor,
): ItemRowStatus | undefined {
    if (!statusFor) return undefined
    let worst: ItemRowStatus | undefined
    let count = 0
    for (const index of indices) {
        const status = statusFor(tools[index], index)
        if (!status) continue
        if (!worst || STATUS_TONE_PRIORITY[status.tone] < STATUS_TONE_PRIORITY[worst.tone]) {
            worst = status
            count = 1
        } else if (status.tone === worst.tone) {
            count += 1
        }
    }
    if (!worst) return undefined
    return count > 1
        ? {...worst, tooltip: tNow("entityUi.configItems.entriesOpenIntegration", {count})}
        : worst
}

/**
 * An integration row on a phone (M08): the logo in a 32 px tile, the name, whose account it uses,
 * and a chevron, 56 px high, edge to edge. A row that needs setup keeps its tag and adds the
 * reason after the account line. No bin: "Remove from agent" is in the integration view.
 */
function PhoneIntegrationRow({
    row,
    name,
    logo,
    status,
    onOpen,
    disabled,
}: {
    row: IntegrationRow
    name: string
    logo: string | null
    status?: ItemRowStatus
    onOpen: () => void
    disabled?: boolean
}) {
    const t = useT(integrationsPhoneCatalog, accountSwitchCatalog)
    const source =
        row.entry?.accountSource === USER_ACCOUNT_SOURCE
            ? t("entityUi.integrationsPhone.eachPersonsOwnAccount")
            : t("entityUi.accountSwitch.oneShared")
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent py-1.5 pl-4 pr-2 text-left font-[inherit] disabled:cursor-default"
        >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ag-colorBgLayout)]">
                <ProviderLogo logo={logo} size={22} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] leading-5 text-[var(--ag-colorText)]">
                    {name}
                </span>
                <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                    {source}
                    {status?.reason ? (
                        <span className="text-[var(--ag-colorWarningText)]">
                            {" · "}
                            {status.reason}
                        </span>
                    ) : null}
                </span>
            </span>
            {status ? <StatusTag status={status} /> : null}
            {disabled ? null : (
                <CaretRight
                    size={14}
                    className="mr-2 shrink-0 text-[var(--ag-colorTextTertiary)]"
                />
            )}
        </button>
    )
}

function IntegrationListRow({
    row,
    tools,
    onOpen,
    onRemove,
    disabled,
    statusFor,
    phone,
}: {
    row: IntegrationRow
    tools: unknown[]
    onOpen: () => void
    onRemove: () => void
    disabled?: boolean
    statusFor?: ToolStatusFor
    phone?: boolean
}) {
    const t = useT(configItemsCatalog, itemDescriptorsCatalog)
    // Selected-integration metadata must not come from the searchable browse query: typing in the
    // open catalog changes that query's pages and would make existing rows lose their logos.
    const {integration} = useToolIntegrationDetail(row.integration)
    const name =
        integration?.name || humanizeActionKey(row.integration) || t("entityUi.configItems.other")
    const indices = useMemo(() => integrationRowIndices(row), [row])
    const status = useMemo(
        () => rollupRowStatus(tools, indices, statusFor),
        [tools, indices, statusFor],
    )

    if (phone) {
        return (
            <PhoneIntegrationRow
                row={row}
                name={name}
                logo={integration?.logo ?? null}
                status={status}
                onOpen={onOpen}
                disabled={disabled}
            />
        )
    }

    return (
        <ItemRow
            descriptor={{
                name,
                monoName: false,
                mono: "",
                // The logo carries the identity here, so the avatar square stays out of the way.
                color: "transparent",
                icon: <ProviderLogo logo={integration?.logo ?? null} size={20} />,
                tags: row.legacyIndices.length > 0 ? [t("entityUi.configItems.oldFormatTag")] : [],
                typeLabel: t("entityUi.itemDescriptors.integrationType"),
                subtitle: t("entityUi.configItems.integrationRowSubtitle", {
                    integration: row.integration,
                }),
            }}
            onEdit={onOpen}
            onRemove={onRemove}
            disabled={disabled}
            status={status}
        />
    )
}

export interface ToolManagementListProps {
    tools: unknown[]
    /** The integration rows, passed in so the rows rendered ARE the ones the drawers act on. */
    integrationRows: IntegrationRow[]
    disabled?: boolean
    /** Opens one integration's permission drawer. Migrates its legacy entries first. */
    onOpenIntegration?: (row: IntegrationRow) => void
    /** Drops every entry an integration owns, in one write. */
    onRemoveIntegration?: (row: IntegrationRow) => void
    /** Per-tool draft/validation status (unsaved edits, missing fields). */
    statusFor?: ToolStatusFor
}

/** Shared empty-state line: one quiet line, the section header's "+" is the way to add. */
function EmptyLine({label}: {label: string}) {
    return <span className="text-[12px] leading-4 text-colorTextTertiary">{label}</span>
}

/** The Integrations section body: one row per connected app, no sub-header. */
export function ToolManagementList({
    tools,
    integrationRows,
    disabled,
    onOpenIntegration,
    onRemoveIntegration,
    statusFor,
}: ToolManagementListProps) {
    const t = useT(configItemsCatalog, itemDescriptorsCatalog)
    // On a phone the section is its own screen: rows edge to edge, "Add integration" at the bottom.
    // The phone section context, not the viewport: -mx-4 undoes the px-4 of that screen.
    const phone = usePhoneSections() !== null
    if (integrationRows.length === 0) {
        if (disabled) return null
        return <EmptyLine label={t("entityUi.configItems.noIntegrationsYet")} />
    }

    return (
        <div
            className={
                phone
                    ? // 8 px under the header (M08): -mt-1 leaves 8 of the screen's 12 px top padding.
                      "-mx-4 -mt-1 flex flex-col"
                    : "flex flex-col gap-2"
            }
        >
            {integrationRows.map((row) => (
                <IntegrationListRow
                    key={`${row.provider}:${row.integration}`}
                    row={row}
                    tools={tools}
                    onOpen={() => onOpenIntegration?.(row)}
                    onRemove={() => onRemoveIntegration?.(row)}
                    disabled={disabled || !onOpenIntegration}
                    statusFor={statusFor}
                    phone={phone}
                />
            ))}
        </div>
    )
}

/** The saved subagents. Stored as `{type: "reference"}` entries; each keeps its array index,
 *  because edit and remove address it by index. */
export function selectSubagentTools(
    tools: unknown[],
    integrationRows: IntegrationRow[],
): IndexedTool[] {
    const claimed = new Set(integrationRows.flatMap(integrationRowIndices))
    const entries: IndexedTool[] = []
    tools.forEach((item, index) => {
        // Legacy harness built-ins are inert: they render nowhere.
        if (isHarnessBuiltinTool(item) || claimed.has(index)) return
        if (isReferenceTool(item)) entries.push({item, index})
    })
    return entries
}

export interface SubagentListProps {
    entries: IndexedTool[]
    /** Saved references whose workflow is not an agent. Listed and removable, never addable. */
    nonAgentSlugs?: Set<string>
    /** Each subagent's icon chrome by slug. Only the caller can reach the icon record. */
    chromeBySlug?: Map<string, {glyph: ReactNode; className: string; style?: CSSProperties}>
    /** Each subagent's CURRENT agent name by slug. Only the caller can resolve the artifact. */
    nameBySlug?: Map<string, string>
    openEdit: (kind: "tool", index: number, item: unknown) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    statusFor?: ToolStatusFor
}

/** The Subagents section body: a flat row list, no sub-header. */
/** Tag a reference whose workflow is not an agent, so it stays visible and removable. */
function markNonAgent(
    descriptor: ItemDescriptor,
    item: unknown,
    nonAgentSlugs?: Set<string>,
): ItemDescriptor {
    if (!nonAgentSlugs?.size) return descriptor
    const slug = toolReferenceSlug(item)
    if (!slug || !nonAgentSlugs.has(slug)) return descriptor
    return {
        ...descriptor,
        tags: [...(descriptor.tags ?? []), tNow("entityUi.configItems.notAnAgentTag")],
    }
}

/** Stable per-entry keys: the saved reference's own slug, never its array position. A config
 *  hand-authored to repeat a slug (or to omit one) falls back to position. The two are namespaced
 *  apart so a slug that reads like a position cannot collide with one. */
function subagentKeys(entries: IndexedTool[]): string[] {
    const seen = new Set<string>()
    return entries.map(({item, index}) => {
        const slug = toolReferenceSlug(item)
        if (!slug || seen.has(slug)) return `subagent-index-${index}`
        seen.add(slug)
        return `subagent-slug-${slug}`
    })
}

export function SubagentList({
    entries,
    nonAgentSlugs,
    chromeBySlug,
    nameBySlug,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    statusFor,
}: SubagentListProps) {
    const t = useT(configItemsCatalog, itemDescriptorsCatalog)
    const keys = subagentKeys(entries)

    if (entries.length === 0) {
        if (disabled) return null
        return <EmptyLine label={t("entityUi.configItems.noSubagentsYet")} />
    }

    return (
        <div className="flex flex-col gap-2">
            {entries.map(({item, index}, position) => (
                <ItemRow
                    key={keys[position]}
                    descriptor={markNonAgent(
                        describeSubagent(
                            item,
                            chromeBySlug?.get(toolReferenceSlug(item) ?? ""),
                            nameBySlug?.get(toolReferenceSlug(item) ?? ""),
                        ),
                        item,
                        nonAgentSlugs,
                    )}
                    onEdit={() => openEdit("tool", index, item)}
                    onRemove={() => {
                        removeItem("tool", index)
                        closeEditor()
                    }}
                    disabled={disabled || ITEM_KINDS.tool.isReadOnly(item)}
                    status={statusFor?.(item, index)}
                />
            ))}
        </div>
    )
}
