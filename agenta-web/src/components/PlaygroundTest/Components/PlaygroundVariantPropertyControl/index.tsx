import MinMaxControl from "./assets/MinMaxControl"
import BooleanControl from "./assets/BooleanControl"
import MultiSelectControl from "./assets/MultiSelectControl"
import SimpleDropdownSelect from "./assets/SimpleDropdownSelect"
import PromptMessageContent from "./assets/PromptMessageContent"

import {memo} from "react"
import {Typography} from "antd"

import {
    isBooleanSchema,
    isEnumSchema,
    isNumberSchema,
    isPromptSchema,
    isRangeNumberSchema,
    isSchemaObject,
    isStringSchema,
} from "./assets/helpers"
import {type PlaygroundVariantPropertyControlProps, type PropertyData} from "./types"
import usePlayground from "../../hooks/usePlayground"

const PlaygroundVariantPropertyControl: React.FC<PlaygroundVariantPropertyControlProps> = ({
    configKey,
    valueKey,
    variantId,
    as,
}) => {
    const {variantConfigProperty} = usePlayground({
        configKey,
        valueKey,
        variantId,
    })
    const {property} = variantConfigProperty || {}

    if (!property?.config) {
        console.log("no config?", property)
        return null
    }

    const {config, valueInfo, handleChange} = property

    console.log("render property control", config.title, config, isStringSchema(config))

    // Number controls
    if (isNumberSchema(config) && isRangeNumberSchema(config)) {
        return (
            <MinMaxControl
                label={config.title || ""}
                min={config.minimum}
                max={config.maximum}
                step={config.multipleOf || 0.1}
                value={valueInfo as number}
                onChange={handleChange}
            />
        )
    }

    // Boolean controls
    if (isBooleanSchema(config)) {
        return (
            <BooleanControl
                label={config.title || ""}
                value={valueInfo as boolean}
                onChange={handleChange}
            />
        )
    }

    // String controls with enum/choices
    if (isStringSchema(config) && isEnumSchema(config)) {
        const options = config.enum || []

        // Use SimpleDropdownSelect when explicitly requested
        if (as === "SimpleDropdownSelect") {
            return (
                <SimpleDropdownSelect
                    value={valueInfo as string}
                    options={options}
                    onChange={handleChange}
                    placeholder={config.title}
                />
            )
        }

        // Default to MultiSelectControl for enum types
        return (
            <MultiSelectControl
                label={config.title || ""}
                options={options.map((value) => ({
                    label: value,
                    value,
                }))}
                value={valueInfo as string | string[]}
                onChange={handleChange}
            />
        )
    }

    if (isStringSchema(config)) {
        // console.log("RENDER STRING", config)
        if (as === "PromptMessageContent") {
            return (
                <PromptMessageContent
                    value={valueInfo as string}
                    placeholder={config.title}
                    onChange={handleChange}
                />
            )
        }
    }
    // Prompt content
    if (isStringSchema(config) && isPromptSchema(config)) {
        if (as === "PromptMessageContent") {
            return (
                <PromptMessageContent
                    value={valueInfo as string}
                    placeholder={config.title}
                    onChange={handleChange}
                />
            )
        }
    }

    // return null;
    if (isSchemaObject(config)) {
        return null
        // (
        //     <div>
        //         <Typography.Text>{config.title}</Typography.Text>
        //         <span>Generic object input (to be implemented)</span>
        //     </div>
        // )
    }

    // Default fallback
    return (
        <div>
            <Typography.Text>{config.title || "Unknown Control"}</Typography.Text>
            <span>Type: {config.type}</span>
        </div>
    )
}

export default memo(PlaygroundVariantPropertyControl)
