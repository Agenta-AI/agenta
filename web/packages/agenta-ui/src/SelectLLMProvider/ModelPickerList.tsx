/**
 * ModelPickerList: the model picker as one inline list grouped by connection (F01 f2), for the
 * Model view and the chat composer's model list. It takes the same groups as
 * `SelectLLMProviderBase`, whose popover stays for the inline controls.
 *
 * Each group shows its logo, name, tag and harness ("via Claude Code") on one row, then its
 * models. A row shows the readable name with the raw id after it. A disabled group (a
 * subscription that needs a new sign-in) is left out: Model providers fixes it.
 */
import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import uiLlmProviderCatalog from "@agenta/i18n/catalogs/ui.llmProvider"
import {Check} from "@phosphor-icons/react"
import clsx from "clsx"

import {SearchInput} from "../components/ui/input-composed"
import {MENU_ITEM} from "../components/ui/menu-item"

import ManageProvidersRow from "./ManageProvidersRow"
import type {ProviderGroup, ProviderOption, ProviderSection} from "./types"
import {getProviderIcon, optionMatchesSearch} from "./utils"

/**
 * "panel": the Model view (F01 f2). Each group head is the name and its tag, with "via <harness>"
 * on its own line, and "Manage model providers" sits on a band across the view's full width. The
 * list sets its own 16px side gutter, so the view gives it the full width.
 * "popover": the composer's list (P1a). Each group head is one line, logo, name and tag, with
 * "via <harness>" at the right.
 */
export type ModelPickerListLayout = "panel" | "popover"

export interface ModelPickerListProps {
    options: ProviderGroup[]
    /** The picked option's key; selects one row when several groups offer the same id. */
    selectedKey?: string | null
    value?: string | null
    onChange: (value: string, option: ProviderOption) => void
    searchPlaceholder?: string
    disabled?: boolean
    /** Shows "Manage model providers" fixed under the list. */
    onManageProviders?: () => void
    /** Fixed under the list in place of "Manage model providers" (the Model view's add action). */
    footer?: ReactNode
    /** Right-aligned in the search field (the `/model` command that opened the list). */
    searchSuffix?: ReactNode
    /** Put the caret in the search field on mount (a list that opens over a composer). */
    autoFocusSearch?: boolean
    layout?: ModelPickerListLayout
}
/** The group's sections with only the options that match; a group with none drops out. */
const filterGroups = (groups: ProviderGroup[], term: string): ProviderGroup[] => {
    if (!term) return groups
    return groups.flatMap((group) => {
        const sections: ProviderSection[] = (
            group.sections ?? [{key: "", label: "", options: group.options}]
        )
            .map((section) => ({
                ...section,
                options: section.options.filter((option) =>
                    optionMatchesSearch(option, group, term),
                ),
            }))
            .filter((section) => section.options.length > 0)
        return sections.length ? [{...group, sections}] : []
    })
}

/**
 * Where the list opens: the group head of the current model at the top, so the user sees whose
 * model it is. A group taller than the list centres the current model instead.
 */
const scrollToCurrent = (list: HTMLElement) => {
    const row = list.querySelector<HTMLElement>("li button[aria-pressed=true]")
    const group = row?.closest<HTMLElement>("section")
    if (!row || !group) return
    const listTop = list.getBoundingClientRect().top - list.scrollTop
    const groupTop = group.getBoundingClientRect().top - listTop
    const rowRect = row.getBoundingClientRect()
    const rowTop = rowRect.top - listTop
    const rowBottom = rowTop + rowRect.height
    list.scrollTop =
        rowBottom - groupTop <= list.clientHeight
            ? groupTop
            : rowTop - (list.clientHeight - rowRect.height) / 2
}

const ModelPickerList = ({
    options,
    selectedKey,
    value,
    onChange,
    searchPlaceholder,
    disabled,
    onManageProviders,
    footer,
    searchSuffix,
    autoFocusSearch,
    layout = "panel",
}: ModelPickerListProps) => {
    const t = useT(uiLlmProviderCatalog, uiControlsCatalog)
    const [search, setSearch] = useState("")
    const term = search.trim().toLowerCase()
    // Only groups with models to pick: a signed-out subscription is fixed in Model providers.
    const groups = useMemo(
        () =>
            filterGroups(
                options.filter((group) => !group.disabled),
                term,
            ),
        [options, term],
    )
    const listRef = useRef<HTMLDivElement | null>(null)
    const popover = layout === "popover"
    const isSelected = (option: ProviderOption) =>
        selectedKey ? (option.key ?? option.value) === selectedKey : option.value === value

    // Once, when the list opens; a later pick or search keeps the user's own scroll.
    useLayoutEffect(() => {
        if (listRef.current) scrollToCurrent(listRef.current)
    }, [])

    const renderRow = (option: ProviderOption) => {
        const selected = isSelected(option)
        return (
            <li key={option.key ?? option.value}>
                <button
                    type="button"
                    // Plain buttons, not a listbox: the view stack keeps Escape (back).
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange(option.value, option)}
                    // A 32 px menu row: the raw id on the same line, after the name (ROW-02).
                    title={option.label !== option.value ? option.value : undefined}
                    className={clsx(
                        MENU_ITEM,
                        "border-0 bg-transparent text-left font-[inherit] hover:bg-accent aria-pressed:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                >
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="shrink-0 truncate text-label text-foreground">
                                {option.label}
                            </span>
                            {option.hint ? (
                                <span className="shrink-0 text-meta text-muted-foreground">
                                    {option.hint}
                                </span>
                            ) : null}
                            {option.label !== option.value ? (
                                <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">
                                    {option.value}
                                </span>
                            ) : null}
                        </span>
                        {option.caption ? (
                            <span className="truncate text-meta text-muted-foreground">
                                {option.caption}
                            </span>
                        ) : null}
                    </span>
                    {selected ? <Check className="text-foreground" /> : null}
                </button>
            </li>
        )
    }

    /** "via Claude Code" for a group with one harness; a group with several names each run. */
    const harnessText = (section: ProviderSection, single: boolean) =>
        single ? `${t("ui.llmProvider.via")} ${section.label}` : section.label

    const renderSection = (section: ProviderSection, single: boolean, headed: boolean) => (
        <div key={section.key} className={clsx("flex flex-col", !popover && "gap-1.5")}>
            {section.label && !headed ? (
                <div
                    className={clsx(
                        "px-2 text-meta",
                        popover ? "pb-1 pt-2 text-muted-foreground" : "text-muted-foreground",
                    )}
                >
                    {harnessText(section, single)}
                </div>
            ) : null}
            <ul className={clsx("m-0 flex list-none flex-col p-0", !popover && "gap-1.5")}>
                {section.options.map(renderRow)}
            </ul>
        </div>
    )

    const renderTag = (group: ProviderGroup) =>
        group.tag ? (
            <span
                // Plain muted text, not a bordered chip (ROW-03).
                className={clsx(
                    "shrink-0 text-meta font-normal text-muted-foreground",
                    !popover && "ml-1.5",
                )}
            >
                {group.tag}
            </span>
        ) : null

    const renderGroup = (group: ProviderGroup) => {
        const sections = group.sections ?? [{key: "", label: "", options: group.options}]
        const single = sections.length === 1
        // A lone harness ("via Claude Code") sits at the right of the group head, on its row.
        const headHarness = single && sections[0].label ? sections[0] : null
        // The provider's logo before its name, in the popover and the list.
        const Icon = getProviderIcon(group.iconKey ?? group.label ?? "")
        return (
            <section
                key={group.key ?? group.label ?? ""}
                className={clsx("flex flex-col", !popover && "gap-1.5")}
            >
                <div
                    className={clsx(
                        "flex min-w-0 items-center px-2 text-meta",
                        popover
                            ? "gap-1.5 pb-1 pt-2 leading-4 text-muted-foreground"
                            : "pb-0.5 pt-2.5 leading-5 text-muted-foreground",
                    )}
                >
                    {Icon ? (
                        <Icon
                            className={clsx(
                                "size-3.5 shrink-0 text-foreground",
                                !popover && "mr-1.5",
                            )}
                        />
                    ) : null}
                    <span className={clsx("truncate", popover && "font-medium text-foreground")}>
                        {group.label}
                    </span>
                    {renderTag(group)}
                    {group.caption ? (
                        <span className="ml-1.5 min-w-0 truncate font-normal text-muted-foreground">
                            {group.caption}
                        </span>
                    ) : null}
                    {headHarness ? (
                        <span className="ml-auto shrink-0 pl-2">
                            {harnessText(headHarness, true)}
                        </span>
                    ) : null}
                </div>
                {sections.map((section) => renderSection(section, single, section === headHarness))}
            </section>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* On a phone 6px above the field leave room for its 44px tap area. */}
            <div
                className={clsx(
                    "shrink-0",
                    popover ? "mx-0.5 mb-1 mt-0.5" : "px-4 pb-1.5 pt-1 max-md:pt-1.5",
                )}
            >
                <SearchInput
                    size="compact-search"
                    // The canvas field (`.find`): a quiet border and no focus ring, even with the
                    // caret in it on open. A phone keeps the 32px field it had.
                    className="border-border-muted"
                    placeholder={searchPlaceholder}
                    value={search}
                    allowClear
                    onValueChange={setSearch}
                    autoFocus={autoFocusSearch}
                    suffix={
                        searchSuffix ? (
                            <span className="font-mono text-caption text-muted-foreground">
                                {searchSuffix}
                            </span>
                        ) : undefined
                    }
                />
            </div>
            <div
                ref={listRef}
                data-testid="model-picker-list"
                className={clsx(
                    "min-h-0 flex-1 overflow-y-auto",
                    !popover && "flex flex-col gap-1.5 px-4",
                )}
            >
                {groups.length ? (
                    groups.map(renderGroup)
                ) : (
                    <p className="m-0 px-3 py-4 text-body text-muted-foreground">
                        {t("ui.controls.noData")}
                    </p>
                )}
            </div>
            {footer ??
                (onManageProviders ? (
                    <div className={clsx("mt-1.5", !popover && "px-3")}>
                        <ManageProvidersRow onClick={onManageProviders} />
                    </div>
                ) : null)}
        </div>
    )
}

export default ModelPickerList
