/**
 * ModelPickerList: the model picker as one inline list grouped by connection (F01 f2), for the
 * Model view and the chat composer's model list. It takes the same groups as
 * `SelectLLMProviderBase`, whose popover stays for the inline controls.
 *
 * Each group shows its logo, name and tag, then its models under their harness line
 * ("via Claude Code"). A row shows the readable name with the raw id under it. A disabled group
 * (a subscription that needs a new sign-in) shows its caption and one action instead of models.
 */
import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import uiLlmProviderCatalog from "@agenta/i18n/catalogs/ui.llmProvider"
import {Check, FadersHorizontal} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "../components/ui/button"
import {SearchInput} from "../components/ui/input-composed"
import {PHONE_TOUCH_TARGET_CLASS} from "../components/ui/touch-target"

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
    /** The action of a disabled group, for example "Sign in". */
    disabledGroupAction?: {label: string; onClick: (group: ProviderGroup) => void}
    /** Shows "Manage model providers" fixed under the list. */
    onManageProviders?: () => void
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
    disabledGroupAction,
    onManageProviders,
    searchSuffix,
    autoFocusSearch,
    layout = "panel",
}: ModelPickerListProps) => {
    const t = useT(uiLlmProviderCatalog, uiControlsCatalog)
    const [search, setSearch] = useState("")
    const term = search.trim().toLowerCase()
    const groups = useMemo(() => filterGroups(options, term), [options, term])
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
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] border-0 bg-transparent px-2 py-[5px] text-left font-[inherit] hover:bg-accent aria-pressed:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] leading-5 text-colorText">
                                {option.label}
                            </span>
                            {option.hint ? (
                                <span className="shrink-0 text-[12px] text-colorTextTertiary">
                                    {option.hint}
                                </span>
                            ) : null}
                        </span>
                        {option.label !== option.value ? (
                            <span className="truncate font-mono text-[11px] leading-5 text-colorTextTertiary">
                                {option.value}
                            </span>
                        ) : null}
                        {option.caption ? (
                            <span className="truncate text-[12px] leading-4 text-colorTextTertiary">
                                {option.caption}
                            </span>
                        ) : null}
                    </span>
                    {selected ? <Check size={14} className="shrink-0 text-colorText" /> : null}
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
                        "px-2 text-[12px] leading-4",
                        popover ? "pb-1 pt-2 text-colorTextSecondary" : "text-colorTextTertiary",
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
                className={clsx(
                    "inline-flex h-5 shrink-0 items-center rounded-[4px] bg-colorBgContainer px-[7px] text-[12px] leading-4 text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary",
                    popover ? "font-normal" : "ml-1.5",
                )}
            >
                {group.tag}
            </span>
        ) : null

    const renderGroup = (group: ProviderGroup) => {
        const sections = group.sections ?? [{key: "", label: "", options: group.options}]
        const single = sections.length === 1
        // The popover names a lone harness at the right of the group head.
        const headHarness =
            popover && single && sections[0].label && !group.disabled ? sections[0] : null
        const Icon = popover ? getProviderIcon(group.iconKey ?? group.label ?? "") : null
        return (
            <section
                key={group.key ?? group.label ?? ""}
                className={clsx("flex flex-col", !popover && "gap-1.5")}
            >
                <div
                    className={clsx(
                        "flex min-w-0 items-center px-2 text-[12px]",
                        popover
                            ? "gap-1.5 pb-1 pt-2 leading-4 text-colorTextSecondary"
                            : "pb-0.5 pt-2.5 font-semibold leading-5 text-zinc-8",
                    )}
                >
                    {Icon ? <Icon className="size-3.5 shrink-0 text-colorText" /> : null}
                    <span className={clsx("truncate", popover && "font-medium text-colorText")}>
                        {group.label}
                    </span>
                    {renderTag(group)}
                    {group.caption && !group.disabled ? (
                        <span className="ml-1.5 min-w-0 truncate font-normal text-colorTextTertiary">
                            {group.caption}
                        </span>
                    ) : null}
                    {headHarness ? (
                        <span className="ml-auto shrink-0 pl-2">
                            {harnessText(headHarness, true)}
                        </span>
                    ) : null}
                </div>
                {group.disabled ? (
                    <div className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[12px] text-colorWarning">{group.caption}</span>
                        {disabledGroupAction ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={disabled}
                                onClick={() => disabledGroupAction.onClick(group)}
                            >
                                {disabledGroupAction.label}
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    sections.map((section) =>
                        renderSection(section, single, section === headHarness),
                    )
                )}
            </section>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className={clsx("shrink-0", popover ? "mx-0.5 mb-1 mt-0.5" : "px-4 pb-1.5")}>
                <SearchInput
                    size="compact-search"
                    // The canvas field (`.find`): a quiet border and no focus ring, even with the
                    // caret in it on open. A phone keeps the 32px field it had.
                    className="border-colorBorderSecondary focus-within:border-colorBorderSecondary focus-within:ring-0 max-md:h-8"
                    placeholder={searchPlaceholder}
                    value={search}
                    allowClear
                    onValueChange={setSearch}
                    autoFocus={autoFocusSearch}
                    suffix={
                        searchSuffix ? (
                            <span className="font-mono text-[11px] text-colorTextTertiary">
                                {searchSuffix}
                            </span>
                        ) : undefined
                    }
                />
            </div>
            <div
                ref={listRef}
                className={clsx(
                    "min-h-0 flex-1 overflow-y-auto",
                    !popover && "flex flex-col gap-1.5 px-4",
                )}
            >
                {groups.length ? (
                    groups.map(renderGroup)
                ) : (
                    <p className="m-0 px-3 py-4 text-sm text-colorTextSecondary">
                        {t("ui.controls.noData")}
                    </p>
                )}
            </div>
            {onManageProviders ? (
                <div
                    className={clsx(
                        "shrink-0 border-0 border-t border-solid",
                        popover
                            ? "mt-1.5 border-colorSplit px-0.5 pb-0.5 pt-2"
                            : "mt-1.5 border-colorBorderSecondary p-3",
                    )}
                >
                    <Button
                        variant="outline"
                        size="compact"
                        className={clsx("h-8 w-full leading-5", PHONE_TOUCH_TARGET_CLASS)}
                        onClick={onManageProviders}
                    >
                        <FadersHorizontal size={14} />
                        {t("ui.llmProvider.manageProviders")}
                    </Button>
                </div>
            ) : null}
        </div>
    )
}

export default ModelPickerList
