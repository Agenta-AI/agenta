import {Fragment, useMemo, useRef, useState} from "react"

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

    const labeledProviders = useMemo(
        () =>
            extendedProviders.map((provider) => ({
                key: provider,
                label: PROVIDER_LABELS[provider] ?? provider,
            })),
        [extendedProviders],
    )

    const providers = useMemo(
        () =>
            labeledProviders.map(({key, label}) => ({
                label,
                options: [label],
                value: key,
            })),
        [labeledProviders],
    )

    const filteredProviders = useMemo(() => {
        if (options) {
            const groupOptions = options.map((group) => ({
                label: group?.label,
                options: group.options.map((option: any) => option?.value),
            }))

            const groupCustomProviders = customRowSecrets
                .map((value) =>
                    showCustomSecretsOnOptions
                        ? {
                              label: capitalize(value.name as string),
                              options: value.modelKeys,
                          }
                        : {},
                )
                .concat(groupOptions as any)
                .filter((group) =>
                    group.options?.some((opt: any) =>
                        opt.toLowerCase().includes(searchTerm.toLowerCase()),
                    ),
                )

            return groupCustomProviders
        }

        return providers.map((group) => ({
            label: group?.label,
            options: group.options.filter((option: any) =>
                option?.toLowerCase().includes(searchTerm.toLowerCase()),
            ),
        }))
    }, [providers, searchTerm, options, customRowSecrets])

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
                            {group.options?.map((option: string) => (
                                <Option key={option} value={option}>
                                    {option}
                                </Option>
                            ))}
                        </OptGroup>
                    ) : (
                        <Fragment key={idx}>
                            {group.options?.map((option: string) => {
                                const Icon = LLMIcons[option]
                                return (
                                    <Option
                                        key={option}
                                        value={option}
                                        className={clsx([
                                            "[&_.ant-select-item-option-content]:flex",
                                            "[&_.ant-select-item-option-content]:items-center",
                                            "[&_.ant-select-item-option-content]:justify-normal",
                                            "[&_.ant-select-item-option-content]:gap-1",
                                        ])}
                                    >
                                        {Icon && <Icon className="w-4 h-4" />}
                                        <span>{option}</span>
                                    </Option>
                                )
                            })}
                        </Fragment>
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
