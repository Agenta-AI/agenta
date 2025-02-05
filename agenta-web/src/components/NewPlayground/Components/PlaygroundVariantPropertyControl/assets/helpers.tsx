import {Typography} from "antd"

import MinMaxControl from "./MinMaxControl"
import BooleanControl from "./BooleanControl"
import MultiSelectControl from "./MultiSelectControl"
import SimpleDropdownSelect from "./SimpleDropdownSelect"
import PromptMessageContent from "./PromptMessageContent"
import TextControl from "./TextControl"
import {ArrayItemValue, RenderFunctions} from "../types"
import {EnhancedConfigValue} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

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

    boolean: ({withTooltip, metadata, value, handleChange}) => (
        <BooleanControl label={metadata.title || ""} value={value} onChange={handleChange} />
    ),

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
                withTooltip={withTooltip}
                disabled={disabled}
            />
        )
    },

    array: ({disabled, withTooltip, metadata, value, handleChange}) => {
        if (!Array.isArray(value?.value)) return null

        return (
            <div className="flex flex-col gap-2">
                {value.value.map((item: EnhancedConfigValue<ArrayItemValue>) => {
                    switch (item.__metadata.type) {
                        case "string":
                            return (
                                <div key={item.__id}>
                                    {renderMap.string({
                                        withTooltip,
                                        metadata: item.__metadata,
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
                                        metadata: item.__metadata,
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
                                        metadata: item.__metadata,
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

    object: () => <Typography.Text>Object input not implemented</Typography.Text>,
    compound: ({withTooltip, metadata}) => {
        return <Typography.Text>Compound input not implemented</Typography.Text>
    },
} as const
