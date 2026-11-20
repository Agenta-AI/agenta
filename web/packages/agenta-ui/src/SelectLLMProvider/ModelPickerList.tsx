/**
 * ModelPickerList: the model picker as one inline list grouped by connection (F01 f2), for the
 * Model view and the chat composer's model list. It takes the same groups as
 * `SelectLLMProviderBase`, whose popover stays for the inline controls.
 *
 * Each group shows its logo, name and tag, then its models under their harness line
 * ("via Claude Code"). A row shows the readable name with the raw id under it. A disabled group
 * (a subscription that needs a new sign-in) shows its caption and one action instead of models.
 */
import {useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import uiLlmProviderCatalog from "@agenta/i18n/catalogs/ui.llmProvider"
import {Check} from "@phosphor-icons/react"
import clsx from "clsx"

import {Button} from "../components/ui/button"
import {SearchInput} from "../components/ui/input-composed"

import type {ProviderGroup, ProviderOption, ProviderSection} from "./types"
import {getHarnessIcon, getProviderIcon, optionMatchesSearch} from "./utils"

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
    /** Fixed under the list (the full-width "Manage model providers"). */
    panelFooter?: ReactNode
    /** Right-aligned in the search field (the `/model` command that opened the list). */
    searchSuffix?: ReactNode
    /** Put the caret in the search field on mount (a list that opens over a composer). */
    autoFocusSearch?: boolean
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

const ModelPickerList = ({
    options,
    selectedKey,
    value,
    onChange,
    searchPlaceholder,
    disabled,
    disabledGroupAction,
    panelFooter,
    searchSuffix,
    autoFocusSearch,
}: ModelPickerListProps) => {
    const t = useT(uiLlmProviderCatalog, uiControlsCatalog)
    const [search, setSearch] = useState("")
    const term = search.trim().toLowerCase()
    const groups = useMemo(() => filterGroups(options, term), [options, term])
    const isSelected = (option: ProviderOption) =>
        selectedKey ? (option.key ?? option.value) === selectedKey : option.value === value

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
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-[5px] text-left font-[inherit] hover:bg-accent aria-pressed:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
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

    const renderSection = (section: ProviderSection, single: boolean) => {
        const Icon = section.iconKey ? getHarnessIcon(section.iconKey) : null
        return (
            <div key={section.key} className="flex flex-col">
                {section.label ? (
                    <div className="flex items-center gap-1.5 px-2 pb-1 text-[12px] leading-4 text-colorTextTertiary">
                        {single ? <span>{t("ui.llmProvider.via")}</span> : null}
                        {Icon ? <Icon className="size-3 shrink-0" /> : null}
                        <span>{section.label}</span>
                    </div>
                ) : null}
                <ul className="m-0 flex list-none flex-col p-0">
                    {section.options.map(renderRow)}
                </ul>
            </div>
        )
    }

    const renderGroup = (group: ProviderGroup) => {
        const Icon = getProviderIcon(group.iconKey ?? group.label ?? "")
        const sections = group.sections ?? [{key: "", label: "", options: group.options}]
        return (
            <section key={group.key ?? group.label ?? ""} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-2.5">
                    {Icon ? <Icon className="size-4 shrink-0" /> : null}
                    <span className="truncate text-[12px] font-semibold leading-5 text-zinc-8">
                        {group.label}
                    </span>
                    {group.tag ? (
                        <span
                            className={clsx(
                                "inline-flex h-5 shrink-0 items-center rounded px-[7px] text-[12px] leading-4",
                                group.tagTone === "olive"
                                    ? "bg-[var(--ag-ref-environment-bg)] text-[var(--ag-ref-environment-text)]"
                                    : "bg-colorBgContainer text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary",
                            )}
                        >
                            {group.tag}
                        </span>
                    ) : null}
                    {group.caption && !group.disabled ? (
                        <span className="min-w-0 truncate text-[12px] text-colorTextTertiary">
                            {group.caption}
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
                    sections.map((section) => renderSection(section, sections.length === 1))
                )}
            </section>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 pb-2">
                <SearchInput
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
            <div className="min-h-0 flex-1 overflow-y-auto">
                {groups.length ? (
                    groups.map(renderGroup)
                ) : (
                    <p className="m-0 px-3 py-4 text-sm text-colorTextSecondary">
                        {t("ui.controls.noData")}
                    </p>
                )}
            </div>
            {panelFooter ? <div className="shrink-0 pt-3">{panelFooter}</div> : null}
        </div>
    )
}

export default ModelPickerList
