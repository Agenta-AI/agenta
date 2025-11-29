import {useMemo, useRef, useState} from "react"

import {Plus} from "@phosphor-icons/react"
import {Select, Input, Button, Divider, InputRef} from "antd"
import clsx from "clsx"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {capitalize} from "@/oss/lib/helpers/utils"
import {SecretDTOProvider, PROVIDER_LABELS} from "@/oss/lib/Types"

import LLMIcons from "../LLMIcons"
import Anthropic from "../LLMIcons/assets/Anthropic"
import Gemini from "../LLMIcons/assets/Gemini"
import Mistral from "../LLMIcons/assets/Mistral"
import OpenAi from "../LLMIcons/assets/OpenAi"
import Together from "../LLMIcons/assets/Together"
import ConfigureProviderDrawer from "../ModelRegistry/Drawers/ConfigureProviderDrawer"

import {SelectLLMProviderProps} from "./types"

const {Option, OptGroup} = Select

type ProviderOption = {
    label: string
    value: string
    key?: string
}

type ProviderGroup = {
    label?: string
    options: ProviderOption[]
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

    const filteredProviders = useMemo(() => {
        const normalizedSearchTerm = searchTerm.trim().toLowerCase()

        const filterGroupOptions = (group: ProviderGroup) => ({
            label: group?.label,
            options: group.options.filter((option) =>
                option.label.toLowerCase().includes(normalizedSearchTerm),
            ),
        })

        if (options) {
            const groupOptions: ProviderGroup[] = options.map((group) => ({
                label: group?.label,
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

    return (
        <>
            <Select
                {...props}
                showSearch={false}
                open={open}
                value={props.value || null}
                onOpenChange={(visible) => setOpen(visible)}
                placeholder="Select a provider"
                style={{width: "100%"}}
                className={clsx([
                    "[&_.ant-select-item-option-content]:flex [&_.ant-select-item-option-content]:items-center [&_>.ant-select-item-option-content]:justify-normal [&_.ant-select-selection-item]:!flex [&_.ant-select-selection-item]:!items-center [&_.ant-select-selection-item]:!gap-1",
                    className,
                ])}
                dropdownRender={(menu) => (
                    <div className="flex flex-col gap-1">
                        {showSearch && (
                            <Input
                                ref={inputRef}
                                placeholder="Search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                variant="borderless"
                                className="border-0 border-b border-solid border-[#f0f0f0] rounded-none py-1.5"
                            />
                        )}

                        {menu}

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
                                        {icons.map((Icon, idx) => (
                                            <Icon
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
                    const GroupIcon = group.label ? LLMIcons[group.label] : null
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
                                const Icon = LLMIcons[option.label]
                                return (
                                    <Option key={option.key ?? option.value} value={option.value}>
                                        {Icon && <Icon className="w-4 h-4" />}
                                        <span>{option.label}</span>
                                    </Option>
                                )
                            })}
                        </OptGroup>
                    ) : (
                        group.options?.map((option) => {
                            const Icon = LLMIcons[option.label]
                            return (
                                <Option
                                    key={option.key ?? option.value}
                                    value={option.value}
                                    className={clsx([
                                        "[&_.ant-select-item-option-content]:flex",
                                        "[&_.ant-select-item-option-content]:items-center",
                                        "[&_.ant-select-item-option-content]:justify-normal",
                                        "[&_.ant-select-item-option-content]:gap-1",
                                    ])}
                                >
                                    {Icon && <Icon className="w-4 h-4" />}
                                    <span>{option.label}</span>
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
