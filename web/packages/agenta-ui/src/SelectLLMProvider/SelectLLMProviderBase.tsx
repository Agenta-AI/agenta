import React, {useMemo, useRef, useState, useEffect} from "react"

import {Input} from "@agenta/primitive-ui/components/input"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {CaretDown, CaretRight, X, Check} from "@phosphor-icons/react"
import clsx from "clsx"

import {LLMIconMap} from "../LLMIcons"

import type {SelectLLMProviderBaseProps, ProviderGroup, ProviderOption} from "./types"
import {getProviderIcon, getProviderDisplayName} from "./utils"

const SelectLLMProviderBase: React.FC<SelectLLMProviderBaseProps> = ({
    showGroup = false,
    showSearch = true,
    options,
    className,
    footerContent,
    onSelectValue,
    value,
    onChange,
    disabled = false,
    size = "default",
    placeholder = "Select a provider",
    ...props
}) => {
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open && inputRef.current) {
            const timer = setTimeout(() => {
                inputRef.current?.focus()
            }, 0)
            return () => clearTimeout(timer)
        }
    }, [open])

    const hasModelOptions =
        options && options.length > 0 && options.some((g) => g.options?.length > 0)

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

    const handleSelect = (selectedValue: string) => {
        if (onSelectValue) {
            onSelectValue(selectedValue)
        }
        if (onChange) {
            onChange(selectedValue, {value: selectedValue})
        }
        setSearchTerm("")
        setHoveredProvider(null)
        setTimeout(() => setOpen(false), 0)
    }

    const selectedOption = useMemo(() => {
        if (!value || !options) return null
        for (const group of options) {
            for (const opt of group.options || []) {
                if (opt.value === value || opt.key === value) return opt
            }
        }
        return null
    }, [value, options])

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
                        <span className="text-[10px] text-nowrap">Input:</span>
                        <span className="text-[10px] text-nowrap">
                            ${formatCost(metadata.input as number)} / 1M
                        </span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-[10px] text-nowrap">Output: </span>
                        <span className="text-[10px] text-nowrap">
                            ${formatCost(metadata.output as number)} / 1M
                        </span>
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
                <Tooltip>
                    <TooltipTrigger
                        render={<span className="contents cursor-pointer">{content}</span>}
                    />
                    <TooltipContent side="right" className="z-[60]">
                        {renderTooltipContent(option.metadata)}
                    </TooltipContent>
                </Tooltip>
            )
        }

        return content
    }

    const selectedIcon = selectedOption
        ? getProviderIcon(selectedOption.value) || LLMIconMap[selectedOption.label]
        : null

    return (
        <Popover
            open={open}
            onOpenChange={(v) => {
                setOpen(v)
                if (!v) {
                    setSearchTerm("")
                    setHoveredProvider(null)
                }
            }}
        >
            <PopoverTrigger
                disabled={disabled}
                render={
                    <button
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        data-size={size}
                        className={clsx(
                            "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pe-2 ps-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-placeholder:text-muted-foreground",
                            className,
                        )}
                        {...props}
                    >
                        <span className="flex flex-1 text-start items-center gap-2 truncate">
                            {selectedOption ? (
                                <>
                                    {selectedIcon && (
                                        <selectedIcon className="w-4 h-4 flex-shrink-0" />
                                    )}
                                    <span className="truncate">{selectedOption.label}</span>
                                </>
                            ) : (
                                <span className="text-muted-foreground">{placeholder}</span>
                            )}
                        </span>
                        <CaretDown className="pointer-events-none size-4 text-muted-foreground shrink-0" />
                    </button>
                }
            />
            <PopoverContent
                side="bottom"
                align="center"
                sideOffset={4}
                className="w-(--anchor-width) min-w-36 p-0 z-50"
                positionerClassName="isolate z-50"
            >
                <div className="flex flex-col gap-1">
                    {showSearch && (
                        <div className="relative border-0 border-b border-solid border-[var(--ag-c-F0F0F0)]">
                            <Input
                                ref={inputRef}
                                placeholder="Search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="rounded-none py-1.5 pr-8 border-0 focus-visible:ring-0 shadow-none"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => {
                                        setSearchTerm("")
                                        inputRef.current?.focus()
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent"
                                >
                                    <X size={12} className="text-gray-400" />
                                </button>
                            )}
                        </div>
                    )}

                    {isSearching || !hasModelOptions || !showGroup ? (
                        <div className="scroll-my-1 p-1 max-h-[300px] overflow-y-auto">
                            {filteredProviders.length === 0 ? (
                                <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                    No providers found
                                </div>
                            ) : (
                                filteredProviders.flatMap((group) =>
                                    group.options.map((option) => (
                                        <div
                                            key={option.key ?? option.value}
                                            role="option"
                                            aria-selected={value === option.value}
                                            className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pe-8 ps-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                                            onMouseDown={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                handleSelect(option.value)
                                            }}
                                        >
                                            <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap items-center">
                                                {renderOption(option)}
                                            </span>
                                            {value === option.value && (
                                                <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center">
                                                    <Check className="size-4" />
                                                </span>
                                            )}
                                        </div>
                                    )),
                                )
                            )}
                        </div>
                    ) : (
                        <div className="py-1 max-h-[300px] overflow-y-auto">
                            {filteredProviders.map((group, idx) => {
                                const Icon = getProviderIcon(group.label || "")
                                const isHovered = hoveredProvider === group.label
                                const displayName = getProviderDisplayName(group.label || "")

                                return (
                                    <Popover
                                        key={`provider-${group.label}-${idx}`}
                                        open={isHovered}
                                        onOpenChange={(visible) => {
                                            setHoveredProvider(visible ? group.label || null : null)
                                        }}
                                    >
                                        <PopoverTrigger
                                            render={
                                                <div
                                                    className={clsx([
                                                        "px-3 py-[5px] cursor-pointer flex items-center gap-2 hover:bg-[var(--ag-c-F5F5F5)]",
                                                        isHovered && "bg-[var(--ag-c-F5F5F5)]",
                                                    ])}
                                                >
                                                    {Icon && (
                                                        <Icon className="w-4 h-4 flex-shrink-0" />
                                                    )}
                                                    <span className="flex-1">{displayName}</span>
                                                    <span className="text-[var(--ag-rgba-000-45)] text-xs">
                                                        {group.options.length}
                                                    </span>
                                                    <CaretRight
                                                        size={12}
                                                        className="text-[var(--ag-rgba-000-45)]"
                                                    />
                                                </div>
                                            }
                                            nativeButton={false}
                                            openOnHover
                                            delay={100}
                                            closeDelay={100}
                                        />
                                        <PopoverContent
                                            side="right"
                                            align="start"
                                            className="w-auto min-w-[200px] p-0 z-[60]"
                                            positionerClassName="isolate z-[60]"
                                        >
                                            <div className="max-h-[300px] overflow-y-auto min-w-[200px] py-1">
                                                {group.options.map((option) => (
                                                    <div
                                                        key={option.key ?? option.value}
                                                        className="px-3 py-[5px] cursor-pointer hover:bg-[var(--ag-c-F5F5F5)] flex items-center gap-2"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault()
                                                            e.stopPropagation()
                                                            handleSelect(option.value)
                                                        }}
                                                    >
                                                        {renderOption(option)}
                                                    </div>
                                                ))}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                )
                            })}
                        </div>
                    )}

                    {footerContent}
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default SelectLLMProviderBase
