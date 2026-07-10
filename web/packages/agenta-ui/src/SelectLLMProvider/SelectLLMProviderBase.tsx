import React, {useMemo, useRef, useState, useEffect} from "react"

import {CaretRight, X} from "@phosphor-icons/react"
import {Input, InputRef, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"

import {LLMIconMap} from "../LLMIcons"
import {bgColors, borderColors} from "../utils/styles"

import type {SelectLLMProviderBaseProps, ProviderGroup, ProviderOption} from "./types"
import {getProviderIcon, getProviderDisplayName} from "./utils"

const {Option, OptGroup} = Select

const DEFAULT_PROVIDER_DROPDOWN_WIDTH = 400

const toCssSize = (value: number | string) => (typeof value === "number" ? `${value}px` : value)

/**
 * Base LLM provider select component.
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
    ...props
}) => {
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)
    const inputRef = useRef<InputRef>(null)

    // Auto focus on input when dropdown opens
    useEffect(() => {
        if (open && inputRef.current?.input) {
            const timer = setTimeout(() => {
                inputRef.current?.input?.focus()
            }, 0)
            return () => clearTimeout(timer)
        }
    }, [open])

    // Check if we have model options (for cascading menu mode)
    const hasModelOptions = Boolean(
        options && options.length > 0 && options.some((g) => g.options?.length > 0),
    )

    const filteredProviders = useMemo(() => {
        if (!options) return []

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

        const groupOptions: ProviderGroup[] = options.map((group) => ({
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

        return groupOptions.map(filterGroupOptions).filter((group) => group.options.length)
    }, [options, searchTerm])

    const isSearching = searchTerm.trim().length > 0
    const shouldUseProviderPanels = hasModelOptions && showGroup
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

    const handleSelect = (value: string, metadata?: Record<string, unknown>) => {
        if (onSelectValue) {
            onSelectValue(value)
        }
        if (props.onChange) {
            props.onChange(value, {value, metadata} as unknown as Parameters<
                NonNullable<typeof props.onChange>
            >[1])
        }
        setSearchTerm("")
        setHoveredProvider(null)
        setTimeout(() => setOpen(false), 0)
    }

    const formatCost = (cost: number) => {
        const value = Number(cost)
        if (isNaN(value)) return "N/A"
        return value < 0.01 ? value.toFixed(4) : value.toFixed(2)
    }

    const renderTooltipContent = (metadata: Record<string, unknown>) => (
        <div className="flex flex-col gap-0.5">
            {(metadata.input !== undefined || metadata.output !== undefined) && (
                <>
                    <div className="flex justify-between gap-4">
                        <Typography.Text className="text-[10px] text-nowrap">
                            Input:
                        </Typography.Text>
                        <Typography.Text className="text-[10px] text-nowrap">
                            ${formatCost(metadata.input as number)} / 1M
                        </Typography.Text>
                    </div>
                    <div className="flex justify-between gap-4">
                        <Typography.Text className="text-[10px] text-nowrap">
                            Output:{" "}
                        </Typography.Text>
                        <Typography.Text className="text-[10px] text-nowrap">
                            ${formatCost(metadata.output as number)} / 1M
                        </Typography.Text>
                    </div>
                </>
            )}
        </div>
    )

    const renderOptionContent = (option: ProviderOption) => {
        const Icon = getProviderIcon(option.value) || LLMIconMap[option.label]
        return (
            <div className="flex items-center gap-2 w-full justify-between group h-full">
                <div className="flex items-center gap-2 overflow-hidden w-full">
                    {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate">{option.label}</span>
                </div>
            </div>
        )
    }

    const renderOption = (option: ProviderOption) => {
        const content = renderOptionContent(option)

        if (option.metadata) {
            return (
                <Tooltip
                    title={renderTooltipContent(option.metadata)}
                    placement="right"
                    mouseEnterDelay={0.3}
                    color="var(--ant-color-bg-elevated)"
                    overlayInnerStyle={{color: "var(--ant-color-text)"}}
                >
                    {content}
                </Tooltip>
            )
        }

        return content
    }

    return (
        <Select
            {...props}
            showSearch={false}
            open={open}
            value={props.value || null}
            onOpenChange={(visible) => {
                setOpen(visible)
                if (!visible) {
                    setSearchTerm("")
                    setHoveredProvider(null)
                }
            }}
            placeholder="Select a provider"
            style={{width: "100%", ...props.style}}
            virtual={false}
            optionLabelProp="label"
            className={clsx([
                "[&_.ant-select-item-option-content]:flex [&_.ant-select-item-option-content]:items-center [&_.ant-select-item-option-content]:gap-2 [&_.ant-select-selection-item]:!flex [&_.ant-select-selection-item]:!items-center [&_.ant-select-selection-item]:!gap-2",
                className,
            ])}
            popupRender={(menu) => (
                <div
                    className="flex flex-col gap-1"
                    style={shouldUseProviderPanels ? {width: providerDropdownWidthCss} : undefined}
                >
                    {showSearch && (
                        <div
                            className={clsx(
                                "relative border-0 border-b border-solid",
                                borderColors.default,
                            )}
                        >
                            <Input
                                ref={inputRef}
                                placeholder="Search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                variant="borderless"
                                className="rounded-none py-1.5 pr-8"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => {
                                        setSearchTerm("")
                                        inputRef.current?.focus()
                                    }}
                                    className={clsx(
                                        "absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded cursor-pointer border-none bg-transparent",
                                        bgColors.hoverState,
                                    )}
                                >
                                    <X size={12} className="text-gray-400" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* When searching or no model options: show standard menu */}
                    {(isSearching || !hasModelOptions || !showGroup) && (
                        <>
                            {menu}
                            {footerContent}
                        </>
                    )}

                    {/* When not searching and has model options with showGroup: show provider/model panels */}
                    {!isSearching && hasModelOptions && showGroup && (
                        <div className="relative min-w-0">
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
                                                onMouseEnter={() =>
                                                    setHoveredProvider(group.label || null)
                                                }
                                                className={clsx([
                                                    "px-3 py-[5px] cursor-pointer flex items-center gap-2",
                                                    bgColors.hoverState,
                                                    isHovered && bgColors.hover,
                                                ])}
                                            >
                                                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                                                <span className="flex-1 truncate">
                                                    {displayName}
                                                </span>
                                                <span className="text-[var(--ag-rgba-000-45)] text-xs">
                                                    {group.options.length}
                                                </span>
                                                <CaretRight
                                                    size={12}
                                                    className="text-[var(--ag-rgba-000-45)] flex-shrink-0"
                                                />
                                            </div>
                                        )
                                    })}
                                </div>

                                {footerContent}
                            </div>

                            {hoveredGroup && (
                                <div
                                    className={clsx(
                                        "absolute inset-y-0 right-0 border-0 border-l border-solid py-1 overflow-y-auto",
                                        borderColors.default,
                                    )}
                                    style={{width: modelListWidthCss}}
                                >
                                    {hoveredGroup.options.map((option) => (
                                        <div
                                            key={option.key ?? option.value}
                                            className={clsx(
                                                "px-3 py-[5px] cursor-pointer flex items-center gap-2",
                                                bgColors.hoverState,
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
            )}
            popupMatchSelectWidth={
                shouldUseProviderPanels
                    ? (props.popupMatchSelectWidth ?? false)
                    : props.popupMatchSelectWidth
            }
        >
            {/* Map out filtered groups and their options */}
            {filteredProviders.map((group, idx) => {
                const GroupIcon = getProviderIcon(group.label || "")
                return showGroup ? (
                    <OptGroup
                        key={idx}
                        label={
                            <div className="flex items-center gap-1">
                                {GroupIcon && <GroupIcon className="w-3 h-3" />}
                                <span>{group.label}</span>
                            </div>
                        }
                    >
                        {group.options?.map((option) => {
                            return (
                                <Option
                                    key={option.key ?? option.value}
                                    value={option.value}
                                    label={renderOptionContent(option)}
                                    metadata={option.metadata}
                                >
                                    {renderOption(option)}
                                </Option>
                            )
                        })}
                    </OptGroup>
                ) : (
                    group.options?.map((option) => {
                        return (
                            <Option
                                key={option.key ?? option.value}
                                value={option.value}
                                label={renderOptionContent(option)}
                                metadata={option.metadata}
                            >
                                {renderOption(option)}
                            </Option>
                        )
                    })
                )
            })}
        </Select>
    )
}

export default SelectLLMProviderBase
