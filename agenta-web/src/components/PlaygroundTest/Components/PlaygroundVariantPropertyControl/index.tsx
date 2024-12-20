import MinMaxControl from "./MinMaxControl"
import BooleanControl from "./BooleanControl"
import MultiSelectControl from "./MultiSelectControl"
import PromptInput from "./PromptInput"

import {memo} from "react"
import {Typography} from "antd"

import usePlaygroundVariantConfig from "../../hooks/usePlaygroundVariantConfig"
import {
    isBooleanSchema,
    isEnumSchema,
    isModelSchema,
    isNumberSchema,
    isPromptSchema,
    isRangeNumberSchema,
    isStringSchema,
} from "./assets/helpers"
import {type PlaygroundVariantPropertyControlProps, type PropertyData} from "./types"

const ModelSelectControl = () => null

const PlaygroundVariantPropertyControl: React.FC<PlaygroundVariantPropertyControlProps> = ({
    configKey,
    valueKey,
    variantId,
}) => {
    const {property} = usePlaygroundVariantConfig({configKey, valueKey, variantId})

    if (!property?.config) {
        return null
    }

    const {config, valueInfo, handleChange} = property

    // Number controls
    if (isNumberSchema(config)) {
        if (isRangeNumberSchema(config)) {
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

        return (
            <div>
                <Typography.Text>{config.title}</Typography.Text>
                <span>Generic number input (to be implemented)</span>
            </div>
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

    // String controls
    if (isStringSchema(config)) {
        // Model selection
        if (isModelSchema(config)) {
            return <ModelSelectControl />
        }

        // Enum selection
        if (isEnumSchema(config)) {
            const options = config.enum?.map(value => ({
                label: value,
                value
            })) || [];

            return (
                <MultiSelectControl
                    label={config.title || ""}
                    options={options}
                    value={valueInfo as string | string[]}
                    onChange={handleChange}
                />
            )
        }

        // Prompt input
        if (isPromptSchema(config)) {
            return (
                <PromptInput
                    title={config.title || ""}
                    value={valueInfo as string}
                    onChange={handleChange}
                />
            )
        }

        // Default string input (could be implemented later)
        return (
            <div>
                <Typography.Text>{config.title}</Typography.Text>
                <span>Generic string input (to be implemented)</span>
            </div>
        )
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
