import {memo} from "react"

import {Typography} from "antd"

import usePlayground from "../../hooks/usePlayground"
import {componentLogger} from "../../assets/utilities/componentLogger"

import MinMaxControl from "./assets/MinMaxControl"
import BooleanControl from "./assets/BooleanControl"
import MultiSelectControl from "./assets/MultiSelectControl"
import SimpleDropdownSelect from "./assets/SimpleDropdownSelect"
import PromptMessageContent from "./assets/PromptMessageContent"
import TextControl from "./assets/TextControl"

import type {PlaygroundVariantPropertyControlProps, RenderFunctions, ArrayItemValue} from "./types"
import type {EnhancedConfigValue} from "../../assets/utilities/genericTransformer/types"

const renderMap: RenderFunctions = {
    number: (metadata, value, handleChange) => {
        return (
            <MinMaxControl
                label={metadata.title || ""}
                value={value}
                onChange={handleChange}
                min={metadata.min}
                max={metadata.max}
                step={metadata.isInteger ? 1 : 0.1}
            />
        )
    },

    boolean: (metadata, value, handleChange) => (
        <BooleanControl label={metadata.title || ""} value={value} onChange={handleChange} />
    ),

    string: (metadata, value, handleChange, as) => {
        if (metadata.options) {
            if (as === "SimpleDropdownSelect") {
                return (
                    <SimpleDropdownSelect
                        value={value}
                        options={metadata.options}
                        onChange={handleChange}
                        placeholder={metadata.description}
                    />
                )
            }
            return (
                <MultiSelectControl
                    label={metadata.title || ""}
                    options={metadata.options}
                    value={value}
                    onChange={handleChange}
                />
            )
        }

        if (as === "PromptMessageContent") {
            return (
                <PromptMessageContent
                    value={value}
                    placeholder={metadata.description}
                    onChange={handleChange}
                />
            )
        }

        return <TextControl metadata={metadata} value={value} handleChange={handleChange} />
    },

    array: (metadata, value, handleChange) => {
        if (!Array.isArray(value?.value)) return null

        return (
            <div className="flex flex-col gap-2">
                {value.value.map((item: EnhancedConfigValue<ArrayItemValue>) => {
                    switch (item.__metadata.type) {
                        case "string":
                            return (
                                <div key={item.__id}>
                                    {renderMap.string(item.__metadata, item.value, (newValue) => {
                                        updateArrayItem(
                                            value.value,
                                            item.__id,
                                            newValue,
                                            handleChange,
                                        )
                                    })}
                                </div>
                            )
                        case "number":
                            return (
                                <div key={item.__id}>
                                    {renderMap.number(item.__metadata, item.value, (newValue) => {
                                        updateArrayItem(
                                            value.value,
                                            item.__id,
                                            newValue,
                                            handleChange,
                                        )
                                    })}
                                </div>
                            )
                        case "boolean":
                            return (
                                <div key={item.__id}>
                                    {renderMap.boolean(item.__metadata, item.value, (newValue) => {
                                        updateArrayItem(
                                            value.value,
                                            item.__id,
                                            newValue,
                                            handleChange,
                                        )
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
    compound: (metadata) => {
        return <Typography.Text>Compound input not implemented</Typography.Text>
    },
} as const

const PlaygroundVariantPropertyControl = ({
    propertyId,
    variantId,
    className,
    as,
}: PlaygroundVariantPropertyControlProps): React.ReactElement | null => {
    componentLogger("PlaygroundVariantPropertyControl", variantId, propertyId)

    const {variantConfigProperty: property} = usePlayground({
        variantId,
        propertyId,
        hookId: "PlaygroundVariantPropertyControl",
    })

    if (!property) {
        return null
    }

    const {__metadata: metadata, value, handleChange} = property

    const renderer = renderMap[metadata.type]
    if (renderer) {
        return renderer(metadata as any, value, handleChange, as)
    }

    return <Typography.Text>Unknown type: {metadata.type}</Typography.Text>
}

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

export default memo(PlaygroundVariantPropertyControl)
