import {Tooltip, Typography} from "antd"
import dynamic from "next/dynamic"

import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {EnhancedConfigValue} from "@/oss/lib/shared/variant/genericTransformer/types"

import {ArrayItemValue, RenderFunctions} from "../types"

import BooleanControl from "./BooleanControl"
import MinMaxControl from "./MinMaxControl"
import MultiSelectControl from "./MultiSelectControl"
import PlaygroundVariantPropertyControlWrapper from "./PlaygroundVariantPropertyControlWrapper"
import PromptMessageContent from "./PromptMessageContent"
import SimpleDropdownSelect from "./SimpleDropdownSelect"
import TextControl from "./TextControl"

const SelectLLMProvider = dynamic(() => import("@/oss/components/SelectLLMProvider"), {ssr: false})

const updateArrayItem = (
    array: EnhancedConfigValue<ArrayItemValue>[],
    id: string,
    newValue: any,
    handleChange: (v: any) => void,
) => {
    const newArray = [...array]
    const index = array.findIndex((v) => v.__id === id)
    if (index !== -1) {
        newArray[index] = {...newArray[index], value: newValue}
        handleChange({value: newArray})
    }
}

export const renderMap: RenderFunctions = {
    number: ({disabled, withTooltip, metadata, value, handleChange}) => {
        return (
            <MinMaxControl
                label={metadata.title || ""}
                value={value}
                onChange={handleChange}
                min={metadata.min}
                max={metadata.max}
                step={metadata.isInteger ? 1 : 0.1}
                withTooltip={withTooltip}
                description={metadata.description}
                disabled={disabled}
            />
        )
    },

    boolean: ({withTooltip, metadata, value, handleChange}) => {
        return (
            <BooleanControl
                description={metadata.description}
                label={metadata.title || ""}
                value={value}
                onChange={handleChange}
            />
        )
    },

    string: ({
        placeholder,
        disabled,
        withTooltip,
        metadata,
        value,
        handleChange,
        as,
        className,
        view,
    }) => {
        if (metadata.options) {
            if (as === "SimpleDropdownSelect") {
                return (
                    <SimpleDropdownSelect
                        value={value}
                        options={metadata.options}
                        onChange={handleChange}
                        placeholder={metadata.description}
                        className={className}
                        description={metadata.description}
                        withTooltip={withTooltip}
                        disabled={disabled}
                    />
                )
            }

            if (metadata.title === "Model") {
                return (
                    <SelectLLMProvider
                        showGroup
                        showAddProvider
                        showCustomSecretsOnOptions
                        options={metadata.options}
                        value={value}
                        onChange={handleChange}
                        disabled={disabled}
                        className="my-4"
                    />
                )
            }

            return (
                <MultiSelectControl
                    label={metadata.title || ""}
                    options={metadata.options}
                    value={value}
                    onChange={handleChange}
                    description={metadata.description}
                    withTooltip={withTooltip}
                    disabled={disabled}
                />
            )
        }

        if (as === "PromptMessageContent") {
            return (
                <PromptMessageContent
                    value={value}
                    placeholder={metadata.description || placeholder}
                    onChange={handleChange}
                    description={metadata.description}
                    withTooltip={withTooltip}
                    view={view}
                    className={className}
                    disabled={disabled}
                />
            )
        }

        return (
            <TextControl
                metadata={metadata}
                value={value}
                handleChange={handleChange}
                className={className}
                view={view}
                description={metadata.description}
                placeholder={placeholder}
                withTooltip={withTooltip}
                disabled={disabled}
                {...(disabled
                    ? {
                          state: "disabled",
                      }
                    : {})}
            />
        )
    },

    array: ({disabled, withTooltip, metadata, value, handleChange}) => {
        if (!Array.isArray(value?.value)) return null

        return (
            <div className="flex flex-col gap-2">
                {value.value.map((item: EnhancedConfigValue<ArrayItemValue>) => {
                    const metadata = getMetadataLazy(item.__metadata)
                    if (!metadata) return null

                    switch (metadata.type) {
                        case "string":
                            return (
                                <div key={item.__id}>
                                    {renderMap.string({
                                        withTooltip,
                                        metadata: metadata,
                                        value: item.value,
                                        disabled,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        case "number":
                            return (
                                <div key={item.__id}>
                                    {renderMap.number({
                                        disabled,
                                        withTooltip,
                                        metadata: metadata,
                                        value: item.value,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        case "boolean":
                            return (
                                <div key={item.__id}>
                                    {renderMap.boolean({
                                        withTooltip,
                                        disabled,
                                        metadata: metadata,
                                        value: item.value,
                                        handleChange: (newValue) => {
                                            updateArrayItem(
                                                value.value,
                                                item.__id,
                                                newValue,
                                                handleChange,
                                            )
                                        },
                                    })}
                                </div>
                            )
                        default:
                            return null
                    }
                })}
            </div>
        )
    },

    object: (props) => {
        const metadata = props.metadata
        const objectProperties = metadata.properties
        const withTooltip = props.withTooltip
        const baseProperty = props.baseProperty
        return (
            <PlaygroundVariantPropertyControlWrapper>
                <div className="border-0 border-t border-solid border-t-[rgba(5,23,41,0.06)] py-3">
                    {withTooltip ? (
                        <Tooltip title={props.metadata.description}>
                            <Typography.Text className="playground-property-control-label text-[14px] w-fit">
                                {props.metadata.key}
                            </Typography.Text>
                        </Tooltip>
                    ) : (
                        <Typography.Text className="playground-property-control-label text-[14px]">
                            {props.metadata.key}
                        </Typography.Text>
                    )}
                </div>

                <div className="">
                    {Object.entries(objectProperties).map(([key, value]) => {
                        const metadataType = value.type
                        const fnc = renderMap[metadataType as keyof typeof renderMap] as
                            | ((props: any) => React.ReactElement)
                            | undefined

                        return fnc ? (
                            <div key={key}>
                                {fnc({
                                    ...props,
                                    metadata: value,
                                    value: baseProperty?.[key]?.value || props.value?.[key] || "",
                                    handleChange: (newValue: any) => {
                                        props.handleChange(
                                            newValue,
                                            undefined,
                                            baseProperty?.[key]?.__id,
                                        )
                                    },
                                })}
                            </div>
                        ) : null
                    })}
                </div>
            </PlaygroundVariantPropertyControlWrapper>
        )
    },
    compound: ({withTooltip, metadata}) => {
        return <Typography.Text>Compound input not implemented</Typography.Text>
    },
} as const
