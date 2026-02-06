import {useMemo, useRef, useState} from "react"

import {CaretRight, Plus, X} from "@phosphor-icons/react"
import {Button, Divider, Input, InputRef, Popover, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {capitalize} from "@/oss/lib/helpers/utils"
import {PROVIDER_LABELS, SecretDTOProvider} from "@/oss/lib/Types"

import LLMIcons from "../LLMIcons"
import Anthropic from "../LLMIcons/assets/Anthropic"
import Gemini from "../LLMIcons/assets/Gemini"
import Mistral from "../LLMIcons/assets/Mistral"
import OpenAi from "../LLMIcons/assets/OpenAi"
import Together from "../LLMIcons/assets/Together"
import ConfigureProviderDrawer from "../ModelRegistry/Drawers/ConfigureProviderDrawer"

import {SelectLLMProviderProps} from "./types"

const {Option, OptGroup} = Select

interface ProviderOption {
    label: string
    value: string
    key?: string
    metadata?: Record<string, any>
}

interface ProviderGroup {
    label?: string | null
    options: ProviderOption[]
}

// Map lowercase provider keys to LLMIcons display labels
const PROVIDER_ICON_MAP: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    groq: "Groq",
    mistral: "Mistral AI",
    gemini: "Google Gemini",
    cohere: "Cohere",
    deepinfra: "DeepInfra",
    openrouter: "OpenRouter",
    perplexityai: "Perplexity AI",
    together_ai: "Together AI",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    azure: "Azure OpenAI",
}

const getProviderIcon = (key: string): React.FC<{className?: string}> | null => {
    const displayName = PROVIDER_ICON_MAP[key?.toLowerCase()]
    if (displayName && LLMIcons[displayName]) return LLMIcons[displayName]
    if (LLMIcons[key]) return LLMIcons[key]
    return null
}

const getProviderDisplayName = (key: string): string => {
    return PROVIDER_ICON_MAP[key?.toLowerCase()] || capitalize(key?.replace(/_/g, " ") || "")
}

const SelectLLMProvider = ({
    showAddProvider = false,
    showGroup = false,
    showSearch = true,
    showCustomSecretsOnOptions = false,
    onAddProviderClick,
    options,
    className,
    ...props
}: SelectLLMProviderProps) => {
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)

    const {customRowSecrets} = useVaultSecret()
    const inputRef = useRef<InputRef>(null)

    // auto focus on input component
    useLazyEffect(() => {
        if (open && inputRef.current?.input) {
            setTimeout(() => {
                inputRef.current?.input?.focus()
            }, 0)
        }
    }, [open])

    const icons = useMemo(() => [OpenAi, Gemini, Anthropic, Mistral, Together], [])

    const extendedProviders = useMemo(
        () => [
            ...Object.values(SecretDTOProvider),
            "vertex_ai",
            "bedrock",
            // "sagemaker",
            "azure",
            "custom",
        ],
        [],
    )

    const labeledProviders = useMemo(() => {
        const labelMap = new Map<string, {key: string; label: string}>()

        extendedProviders.forEach((provider) => {
            const label = PROVIDER_LABELS[provider] ?? provider
            labelMap.set(label.toLowerCase(), {key: provider, label})
        })

        return Array.from(labelMap.values())
    }, [extendedProviders])

    const providers = useMemo(
        () =>
            labeledProviders.map<ProviderGroup>(({key, label}) => ({
                label,
                options: [
                    {
                        label,
                        value: key,
                        key,
                    },
                ],
            })),
        [labeledProviders],
    )

    // Check if we have model options (for cascading menu mode)
    const hasModelOptions =
        options && options.length > 0 && options.some((g: any) => g.options?.length > 0)

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

        if (options) {
            const groupOptions: ProviderGroup[] = options.map((group) => ({
                label: group?.label as string | undefined,
                options:
                    (group.options
                        ?.map((option: any) => {
                            if (!option) return undefined
                            if (typeof option === "string") {
                                return {
                                    label: option,
                                    value: option,
                                    key: option,
                                }
                            }
                            const optionLabel = option?.label ?? option?.value
                            const optionValue = option?.value ?? option?.label

                            if (!optionLabel && !optionValue) return undefined
                            const resolvedLabel = optionLabel || optionValue
                            const resolvedValue = optionValue || optionLabel

                            return {
                                label: resolvedLabel,
                                value: resolvedValue,
                                key: option?.key ?? resolvedValue,
                                metadata: option?.metadata,
                            }
                        })
                        .filter(Boolean) as ProviderOption[]) ?? [],
            }))

            const groupCustomProviders: ProviderGroup[] = customRowSecrets
                .map((value) => {
                    if (!showCustomSecretsOnOptions) return undefined
                    return {
                        label: capitalize(value.name as string),
                        options: (value.modelKeys ?? []).map((modelKey: string) => ({
                            label: modelKey,
                            value: modelKey,
                            key: modelKey,
                        })),
                    }
                })
                .filter(Boolean) as ProviderGroup[]

            return groupCustomProviders
                .concat(groupOptions)
                .map(filterGroupOptions)
                .filter((group) => group.options.length)
        }

        return providers.map(filterGroupOptions).filter((group) => group.options.length)
    }, [providers, searchTerm, options, customRowSecrets, showCustomSecretsOnOptions])

    const isSearching = searchTerm.trim().length > 0

    const handleSelect = (value: string) => {
        if (props.onChange) {
            props.onChange(value, {value} as any)
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

    const renderTooltipContent = (metadata: Record<string, any>) => (
        <div className="flex flex-col gap-0.5">
            {(metadata.input !== undefined || metadata.output !== undefined) && (
                <>
                    <div className="flex justify-between gap-4">
                        <Typography.Text className="text-[10px] text-nowrap">
                            Input:
                        </Typography.Text>
                        <Typography.Text className="text-[10px] text-nowrap">
                            ${formatCost(metadata.input)} / 1M
                        </Typography.Text>
                    </div>
                    <div className="flex justify-between gap-4">
                        <Typography.Text className="text-[10px] text-nowrap">
                            Output:{" "}
                        </Typography.Text>
                        <Typography.Text className="text-[10px] text-nowrap">
                            ${formatCost(metadata.output)} / 1M
                        </Typography.Text>
                    </div>
                </>
            )}
        </div>
    )

    const renderOptionContent = (option: ProviderOption) => {
        const Icon = getProviderIcon(option.value) || LLMIcons[option.label]
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
                    color="white"
                >
                    {content}
                </Tooltip>
            )
        }

        return content
    }

    return (
        <>
            <Select
                {...props}
                showSearch={false}
                open={open}
                value={props.value || null}
                onDropdownVisibleChange={(visible) => {
                    setOpen(visible)
                    if (!visible) {
                        setSearchTerm("")
                        setHoveredProvider(null)
                    }
                }}
                placeholder="Select a provider"
                style={{width: "100%"}}
                virtual={false}
                optionLabelProp="label"
                className={clsx([
                    "[&_.ant-select-item-option-content]:flex [&_.ant-select-item-option-content]:items-center [&_.ant-select-item-option-content]:gap-2 [&_.ant-select-selection-item]:!flex [&_.ant-select-selection-item]:!items-center [&_.ant-select-selection-item]:!gap-2",
                    className,
                ])}
                popupRender={(menu) => (
                    <div className="flex flex-col gap-1">
                        {showSearch && (
                            <div className="relative border-0 border-b border-solid border-[#f0f0f0]">
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
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded cursor-pointer border-none bg-transparent"
                                    >
                                        <X size={12} className="text-gray-400" />
                                    </button>
                                )}
                            </div>
                        )}

                        {/* When searching or no model options: show standard menu */}
                        {(isSearching || !hasModelOptions || !showGroup) && menu}

                        {/* When not searching and has model options with showGroup: show cascading menu */}
                        {!isSearching && hasModelOptions && showGroup && (
                            <div className="py-1">
                                {filteredProviders.map((group, idx) => {
                                    const Icon = getProviderIcon(group.label || "")
                                    const isHovered = hoveredProvider === group.label
                                    const displayName = getProviderDisplayName(group.label || "")

                                    return (
                                        <Popover
                                            key={`provider-${group.label}-${idx}`}
                                            placement="rightTop"
                                            open={isHovered}
                                            onOpenChange={(visible) =>
                                                setHoveredProvider(
                                                    visible ? group.label || null : null,
                                                )
                                            }
                                            arrow={false}
                                            styles={{body: {padding: 0}}}
                                            content={
                                                <div className="max-h-[300px] overflow-y-auto min-w-[200px] py-1">
                                                    {group.options.map((option) => (
                                                        <div
                                                            key={option.key ?? option.value}
                                                            className="px-3 py-[5px] cursor-pointer hover:bg-[#f5f5f5] flex items-center gap-2"
                                                            onMouseDown={(e) => {
                                                                // Prevent focus/blur weirdness inside Select dropdown,
                                                                // and make sure our close logic runs before unmount.
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                handleSelect(option.value)
                                                            }}
                                                        >
                                                            {renderOption(option)}
                                                        </div>
                                                    ))}
                                                </div>
                                            }
                                            trigger="hover"
                                        >
                                            <div
                                                className={clsx([
                                                    "px-3 py-[5px] cursor-pointer flex items-center gap-2 hover:bg-[#f5f5f5]",
                                                    isHovered && "bg-[#f5f5f5]",
                                                ])}
                                            >
                                                {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                                                <span className="flex-1">{displayName}</span>
                                                <span className="text-[rgba(0,0,0,0.45)] text-xs">
                                                    {group.options.length}
                                                </span>
                                                <CaretRight
                                                    size={12}
                                                    className="text-[rgba(0,0,0,0.45)]"
                                                />
                                            </div>
                                        </Popover>
                                    )
                                })}
                            </div>
                        )}

                        {showAddProvider && (
                            <>
                                <Divider className="!mx-0 !my-0.5" />
                                <Button
                                    className="flex items-center justify-between mb-0.5 px-2"
                                    onClick={() =>
                                        showAddProvider && onAddProviderClick
                                            ? onAddProviderClick
                                            : setIsConfigProviderOpen(true)
                                    }
                                    type="text"
                                    variant="outlined"
                                >
                                    <span className="flex items-center gap-1">
                                        <Plus size={14} /> Add provider
                                    </span>

                                    <div className="flex items-center gap-0.5">
                                        {icons.map((IconComp, idx) => (
                                            <IconComp
                                                key={`provider-icon-${idx}`}
                                                className="w-5 h-5"
                                            />
                                        ))}
                                    </div>
                                </Button>
                            </>
                        )}
                    </div>
                )}
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
                                >
                                    {renderOption(option)}
                                </Option>
                            )
                        })
                    )
                })}
            </Select>

            {showAddProvider && (
                <ConfigureProviderDrawer
                    open={isConfigProviderOpen}
                    onClose={() => setIsConfigProviderOpen(false)}
                />
            )}
        </>
    )
}

export default SelectLLMProvider
