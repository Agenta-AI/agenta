import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from "react"

import {CaretRight, X} from "@phosphor-icons/react"
import clsx from "clsx"
import {ChevronDown} from "lucide-react"

import {Input} from "../components/ui/input"
import {Popover, PopoverContent, PopoverTrigger} from "../components/ui/popover"
import {selectTriggerVariants} from "../components/ui/select"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../components/ui/tooltip"
import {LLMIconMap} from "../LLMIcons"

import type {SelectLLMProviderBaseProps, ProviderGroup, ProviderOption, SelectSize} from "./types"
import {getProviderIcon, getProviderDisplayName} from "./utils"

const DEFAULT_PROVIDER_DROPDOWN_WIDTH = 400

const toCssSize = (value: number | string) => (typeof value === "number" ? `${value}px` : value)

/** antd size → the shared control scale used by Select/Combobox triggers. */
const TRIGGER_SIZE: Record<SelectSize, "sm" | "default" | "lg"> = {
    small: "sm",
    middle: "default",
    large: "lg",
}

/** antd dropdown item geometry, identical to the Combobox rows so the two read as one system. */
const ROW_CLASS =
    "box-border flex w-full min-h-control cursor-pointer select-none items-center gap-2 rounded-control-sm px-3 py-1 text-field-md"

/**
 * Base LLM provider select component.
 *
 * A popover-hosted picker rather than a `Combobox`: the search box lives INSIDE the panel
 * (Combobox searches from the trigger), the grouped mode is a two-column provider → model
 * cascade, and the panel width is decoupled from the trigger width. The trigger still reuses
 * `selectTriggerVariants`, so it stays dimensionally identical to Select/Combobox.
 *
 * This is a presentational component that can be extended in OSS with
 * vault integration and other features.
 *
 * @example Basic Usage
 * ```tsx
 * <SelectLLMProviderBase
 *   value={provider}
 *   onChange={setProvider}
 *   options={providerOptions}
 *   showSearch
 *   showGroup
 * />
 * ```
 */
const SelectLLMProviderBase: React.FC<SelectLLMProviderBaseProps> = ({
    showGroup = false,
    showSearch = true,
    options,
    className,
    footerContent,
    onSelectValue,
    providerDropdownWidth = DEFAULT_PROVIDER_DROPDOWN_WIDTH,
    modelListWidth,
    emptyText = "No data",
    container,
    value,
    onChange,
    placeholder = "Select a provider",
    disabled = false,
    invalid = false,
    size = "middle",
    style,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}) => {
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)
    // null = focus sits in the provider column; a number = the highlighted model row.
    const [activeModelIndex, setActiveModelIndex] = useState<number | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    // Stable ids so the search field can point at the listbox and its highlighted row.
    const rid = useId()
    const listId = `${rid}-listbox`
    const optionId = (index: number) => `${rid}-opt-${index}`

    // Normalize the loose incoming option shapes ONCE, before filtering, so the trigger can
    // still resolve the selected label while a search is narrowing the list.
    const normalizedGroups = useMemo<ProviderGroup[]>(() => {
        if (!options) return []

        return options.map((group) => ({
            label: group?.label as string | undefined,
            options:
                (group.options
                    ?.map((option: unknown) => {
                        const opt = option as Record<string, unknown> | string | null
                        if (!opt) return undefined
                        if (typeof opt === "string") {
                            return {
                                label: opt,
                                value: opt,
                                key: opt,
                            }
                        }
                        const optionLabel = (opt.label ?? opt.value) as string | undefined
                        const optionValue = (opt.value ?? opt.label) as string | undefined

                        if (!optionLabel && !optionValue) return undefined
                        const resolvedLabel = optionLabel || optionValue
                        const resolvedValue = optionValue || optionLabel

                        return {
                            label: resolvedLabel,
                            value: resolvedValue,
                            key: (opt.key as string | undefined) ?? resolvedValue,
                            metadata: opt.metadata as Record<string, unknown> | undefined,
                        }
                    })
                    .filter(Boolean) as ProviderOption[]) ?? [],
        }))
    }, [options])

    // Check if we have model options (for cascading menu mode)
    const hasModelOptions = Boolean(
        options && options.length > 0 && options.some((g) => g.options?.length > 0),
    )

    const filteredProviders = useMemo(() => {
        const normalizedSearchTerm = searchTerm.trim().toLowerCase()

        const filterGroupOptions = (group: ProviderGroup): ProviderGroup => ({
            label: group?.label,
            options: group.options.filter(
                (option) =>
                    option.label.toLowerCase().includes(normalizedSearchTerm) ||
                    option.value.toLowerCase().includes(normalizedSearchTerm) ||
                    group.label?.toLowerCase().includes(normalizedSearchTerm),
            ),
        })

        return normalizedGroups.map(filterGroupOptions).filter((group) => group.options.length)
    }, [normalizedGroups, searchTerm])

    const isSearching = searchTerm.trim().length > 0
    const shouldUseProviderPanels = hasModelOptions && showGroup
    // The panel cascade only renders when there is nothing to search through.
    const showPanels = shouldUseProviderPanels && !isSearching
    const hoveredGroup = useMemo(
        () => filteredProviders.find((group) => group.label === hoveredProvider) ?? null,
        [filteredProviders, hoveredProvider],
    )
    const providerDropdownWidthCss = toCssSize(providerDropdownWidth)
    const resolvedModelListWidth =
        modelListWidth ??
        (typeof providerDropdownWidth === "number" ? providerDropdownWidth / 2 : "50%")
    const modelListWidthCss = toCssSize(resolvedModelListWidth)
    const providerPanelWidth = hoveredGroup ? `calc(100% - ${modelListWidthCss})` : "100%"

    /** Rows of the non-cascading list (search results, or the flat/ungrouped mode). */
    const flatItems = useMemo(
        () => filteredProviders.flatMap((group) => group.options),
        [filteredProviders],
    )

    // `optionLabelProp="label"`: the trigger renders the option's own label node, resolved
    // against the FULL option set so a live search never blanks the current selection.
    const selectedOption = useMemo(
        () =>
            value
                ? normalizedGroups.flatMap((g) => g.options).find((o) => o.value === value)
                : undefined,
        [normalizedGroups, value],
    )

    const closeDropdown = useCallback(() => {
        setOpen(false)
        setSearchTerm("")
        setHoveredProvider(null)
        setActiveModelIndex(null)
    }, [])

    const handleSelect = useCallback(
        (optionValue: string, metadata?: Record<string, unknown>) => {
            onSelectValue?.(optionValue)
            onChange?.(optionValue, {value: optionValue, metadata})
            closeDropdown()
        },
        [closeDropdown, onChange, onSelectValue],
    )

    // On open (and whenever the result set changes) highlight the selected row, else the first.
    useEffect(() => {
        if (!open) return
        const selectedIdx = flatItems.findIndex((o) => o.value === value)
        setActiveIndex(!isSearching && selectedIdx >= 0 ? selectedIdx : 0)
    }, [open, flatItems, isSearching, value])

    useEffect(() => {
        if (!open) return
        panelRef.current?.querySelector("[data-active=true]")?.scrollIntoView({block: "nearest"})
    }, [open, activeIndex, activeModelIndex, hoveredProvider])

    const providerIndex = filteredProviders.findIndex((g) => g.label === hoveredProvider)

    // The enclosing drawer (a modal Radix Sheet) locks page scroll via react-remove-scroll,
    // which intercepts wheel events globally and doesn't recognize this popover's own list —
    // a separate portal — as a scrollable region, so the native wheel gesture never reaches
    // it (keyboard nav still works since that's JS-driven, not a browser scroll). Apply the
    // scroll ourselves so it doesn't depend on the browser's default wheel handling at all.
    const handleWheelScroll = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.currentTarget.scrollTop += e.deltaY
    }, [])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const move = (list: unknown[], from: number, dir: 1 | -1) =>
            list.length ? (from + dir + list.length) % list.length : 0

        if (showPanels) {
            const models = hoveredGroup?.options ?? []
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                const dir = e.key === "ArrowDown" ? 1 : -1
                if (activeModelIndex !== null) {
                    setActiveModelIndex(move(models, activeModelIndex, dir))
                } else {
                    const next = move(
                        filteredProviders,
                        providerIndex < 0 ? -1 : providerIndex,
                        dir,
                    )
                    setHoveredProvider(filteredProviders[next]?.label ?? null)
                }
            } else if (e.key === "ArrowRight" && models.length) {
                e.preventDefault()
                setActiveModelIndex(0)
            } else if (e.key === "ArrowLeft") {
                e.preventDefault()
                setActiveModelIndex(null)
            } else if (e.key === "Enter") {
                e.preventDefault()
                if (activeModelIndex !== null) {
                    const option = models[activeModelIndex]
                    if (option) handleSelect(option.value, option.metadata)
                } else if (models.length) {
                    setActiveModelIndex(0)
                }
            }
            return
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setActiveIndex((i) => move(flatItems, i, e.key === "ArrowDown" ? 1 : -1))
        } else if (e.key === "Home") {
            e.preventDefault()
            setActiveIndex(0)
        } else if (e.key === "End") {
            e.preventDefault()
            setActiveIndex(Math.max(flatItems.length - 1, 0))
        } else if (e.key === "Enter") {
            e.preventDefault()
            const option = flatItems[activeIndex]
            if (option) handleSelect(option.value, option.metadata)
        }
    }

    const formatCost = (cost: number) => {
        const value = Number(cost)
        if (isNaN(value)) return "N/A"
        return value < 0.01 ? value.toFixed(4) : value.toFixed(2)
    }

    const renderTooltipContent = (metadata: Record<string, unknown>) => (
        <div className="flex flex-col gap-0.5">
            {typeof metadata.description === "string" && metadata.description && (
                <span className="mb-0.5 inline-block max-w-[220px] text-[12px]">
                    {metadata.description}
                </span>
            )}
            {(metadata.input !== undefined || metadata.output !== undefined) && (
                <>
                    <div className="flex justify-between gap-4">
                        <span className="text-nowrap text-[12px]">Input:</span>
                        <span className="text-nowrap text-[12px]">
                            ${formatCost(metadata.input as number)} / 1M
                        </span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-nowrap text-[12px]">Output: </span>
                        <span className="text-nowrap text-[12px]">
                            ${formatCost(metadata.output as number)} / 1M
                        </span>
                    </div>
                </>
            )}
        </div>
    )

    /** The label node — shown BOTH in the list row and (for the selected option) in the trigger. */
    const renderOptionContent = (option: ProviderOption) => {
        const Icon = getProviderIcon(option.value) || LLMIconMap[option.label]
        return (
            <span className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">{option.label}</span>
            </span>
        )
    }

    const renderOption = (option: ProviderOption) => {
        const content = renderOptionContent(option)

        if (option.metadata) {
            return (
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>{content}</TooltipTrigger>
                        <TooltipContent
                            side="right"
                            container={container ?? undefined}
                            className="bg-colorBgElevated text-colorText [&_svg]:fill-colorBgElevated"
                        >
                            {renderTooltipContent(option.metadata)}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )
        }

        return content
    }

    const renderListRow = (option: ProviderOption, index: number) => (
        <div
            key={option.key ?? option.value}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            data-active={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSelect(option.value, option.metadata)}
            className={clsx(
                ROW_CLASS,
                option.value === value
                    ? "bg-controlItemBgActive font-semibold"
                    : "data-[active=true]:bg-muted",
            )}
        >
            {renderOption(option)}
        </div>
    )

    let flatRowIndex = -1

    // antd greys only the placeholder/arrow, and turns the whole control red on error.
    const adornmentColor = invalid ? "text-error" : "text-placeholder"

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setOpen(true)
                else closeDropdown()
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    id={id}
                    // Not `role=combobox`: the search field inside the panel owns the
                    // combobox/listbox relationship, this is the disclosure button.
                    // Radix supplies aria-expanded / aria-controls.
                    aria-haspopup="listbox"
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledby}
                    aria-invalid={invalid || undefined}
                    disabled={disabled}
                    data-placeholder={selectedOption || value ? undefined : ""}
                    className={clsx(
                        selectTriggerVariants({size: TRIGGER_SIZE[size]}),
                        "text-left",
                        className,
                    )}
                    style={{width: "100%", ...style}}
                >
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        {selectedOption ? (
                            renderOptionContent(selectedOption)
                        ) : value ? (
                            <span className="truncate">{value}</span>
                        ) : (
                            <span className={clsx("truncate", adornmentColor)}>{placeholder}</span>
                        )}
                    </span>
                    <ChevronDown className={clsx("size-3 shrink-0", adornmentColor)} />
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="start"
                container={container}
                onOpenAutoFocus={(e) => {
                    if (!showSearch) return
                    e.preventDefault()
                    inputRef.current?.focus()
                }}
                onKeyDown={handleKeyDown}
                className={clsx(
                    "p-1",
                    // antd's `popupMatchSelectWidth`: the cascade sizes itself, everything else
                    // tracks the trigger.
                    shouldUseProviderPanels ? "w-auto" : "w-[var(--radix-popover-trigger-width)]",
                )}
            >
                <div
                    ref={panelRef}
                    className="flex flex-col gap-1"
                    style={shouldUseProviderPanels ? {width: providerDropdownWidthCss} : undefined}
                >
                    {showSearch && (
                        <div className="relative border-0 border-b border-solid border-border">
                            <Input
                                ref={inputRef}
                                placeholder="Search"
                                aria-label="Search"
                                aria-controls={showPanels ? undefined : listId}
                                aria-activedescendant={
                                    showPanels || !flatItems[activeIndex]
                                        ? undefined
                                        : optionId(activeIndex)
                                }
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                variant="ghost"
                                className="rounded-none py-1.5 pr-8"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    aria-label="Clear search"
                                    onClick={() => {
                                        setSearchTerm("")
                                        inputRef.current?.focus()
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded border-none bg-transparent p-1 hover:bg-muted"
                                >
                                    <X size={12} className="text-placeholder" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* When searching or no model options: show the standard list */}
                    {!showPanels && (
                        <>
                            <div
                                id={listId}
                                role="listbox"
                                aria-label={ariaLabel ?? "Options"}
                                className="max-h-[256px] overflow-y-auto"
                                onWheel={handleWheelScroll}
                            >
                                {flatItems.length === 0 ? (
                                    <div className="py-4 text-center text-field-sm text-placeholder">
                                        {emptyText}
                                    </div>
                                ) : (
                                    filteredProviders.map((group, idx) => {
                                        const GroupIcon = getProviderIcon(group.label || "")
                                        const rows = group.options.map((option) => {
                                            flatRowIndex += 1
                                            return renderListRow(option, flatRowIndex)
                                        })

                                        return showGroup ? (
                                            <div
                                                key={`group-${group.label}-${idx}`}
                                                role="group"
                                                aria-label={group.label ?? undefined}
                                            >
                                                <div
                                                    role="presentation"
                                                    className="flex items-center gap-1 px-3 py-[5px] text-field-sm text-placeholder"
                                                >
                                                    {GroupIcon && <GroupIcon className="w-3 h-3" />}
                                                    <span>{group.label}</span>
                                                </div>
                                                {rows}
                                            </div>
                                        ) : (
                                            <React.Fragment key={`group-${group.label}-${idx}`}>
                                                {rows}
                                            </React.Fragment>
                                        )
                                    })
                                )}
                            </div>
                            {footerContent}
                        </>
                    )}

                    {/* When not searching and has model options with showGroup: provider/model panels */}
                    {showPanels && (
                        <div className="relative flex min-h-[220px] min-w-0">
                            <div
                                className="flex min-w-0 flex-col"
                                style={{width: providerPanelWidth}}
                            >
                                <div className="py-1">
                                    {filteredProviders.map((group, idx) => {
                                        const Icon = getProviderIcon(group.label || "")
                                        const isHovered = hoveredProvider === group.label
                                        const displayName = getProviderDisplayName(
                                            group.label || "",
                                        )

                                        return (
                                            <div
                                                key={`provider-${group.label}-${idx}`}
                                                data-active={isHovered && activeModelIndex === null}
                                                onMouseEnter={() => {
                                                    setHoveredProvider(group.label || null)
                                                    setActiveModelIndex(null)
                                                }}
                                                className={clsx(
                                                    ROW_CLASS,
                                                    "hover:bg-muted",
                                                    isHovered && "bg-muted",
                                                )}
                                            >
                                                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                                                <span className="flex-1 truncate">
                                                    {displayName}
                                                </span>
                                                <span className="text-xs text-colorTextTertiary">
                                                    {group.options.length}
                                                </span>
                                                <CaretRight
                                                    size={12}
                                                    className="flex-shrink-0 text-colorTextTertiary"
                                                />
                                            </div>
                                        )
                                    })}
                                </div>

                                {footerContent && (
                                    <div className="mt-auto w-full">{footerContent}</div>
                                )}
                            </div>

                            {hoveredGroup && (
                                <div
                                    role="listbox"
                                    aria-label={hoveredGroup.label ?? "Models"}
                                    className="absolute inset-y-0 right-0 overflow-y-auto border-0 border-l border-solid border-border py-1"
                                    style={{width: modelListWidthCss}}
                                    onWheel={handleWheelScroll}
                                >
                                    {hoveredGroup.options.map((option, index) => (
                                        <div
                                            key={option.key ?? option.value}
                                            role="option"
                                            aria-selected={option.value === value}
                                            data-active={index === activeModelIndex}
                                            onMouseEnter={() => setActiveModelIndex(index)}
                                            className={clsx(
                                                ROW_CLASS,
                                                "hover:bg-muted data-[active=true]:bg-muted",
                                            )}
                                            onMouseDown={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                handleSelect(option.value, option.metadata)
                                            }}
                                        >
                                            {renderOption(option)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default SelectLLMProviderBase
