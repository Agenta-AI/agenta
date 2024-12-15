import {memo, useCallback, useMemo} from "react"
import {Typography} from "antd"
import MinMaxControl from "./MinMaxControl"
import BooleanControl from "./BooleanControl"
import MultiSelectControl from "./MultiSelectControl"
import PromptInput from "./PromptInput"
import type {ConfigPropertyType} from "../../state/types"
import usePlaygroundVariantConfig from "../../hooks/usePlaygroundVariantConfig"

interface PropertyWithHandler extends Omit<ConfigPropertyType, "type"> {
    type: string
    handleChange: (value: unknown) => void
    minimum?: number
    maximum?: number
    choices?: Record<string, string[]>
}

const PlaygroundVariantPropertyControl = ({
    configKey,
    variantId,
}: {
    configKey: string
    variantId: string
}) => {
    const {mutateVariant, config} = usePlaygroundVariantConfig({
        configKey,
        variantId,
    })

    console.log("render property", configKey)
    const property = useMemo((): PropertyWithHandler => {
        /**
         * A generic function that updates a variant prompt's parameters
         * @param e
         * @param param
         */
        interface HandleParamUpdateEvent {
            target: {
                value: string | boolean | string[]
            }
        }

        const handleParamUpdate = (e: HandleParamUpdateEvent | string | boolean | string[]) => {
            const val = Array.isArray(e) ? e : typeof e === "object" ? e.target.value : e

            console.log("handleParamUpdate", val)
            mutateVariant(variantId, val)
        }

        return {
            ...config,
            handleChange: (e: HandleParamUpdateEvent | string | boolean | string[]) =>
                handleParamUpdate(e),
        }
    }, [config, mutateVariant, variantId])

    switch (property.type) {
        case "number":
        case "integer":
            if (!Number.isNaN(property.minimum) && !Number.isNaN(property.maximum)) {
                return (
                    <MinMaxControl
                        label={property.title}
                        min={property.minimum}
                        max={property.maximum}
                        step={0.1}
                        value={property.default as number}
                        onChange={property.handleChange}
                    />
                )
            } else {
                return (
                    <div>
                        <Typography.Text>{property.title}</Typography.Text>
                        number
                    </div>
                )
            }
        case "boolean":
            return (
                <BooleanControl
                    label={property.title}
                    value={property.default as boolean}
                    onChange={property.handleChange}
                />
            )
        case "string":
            if (property.choices) {
                return (
                    <MultiSelectControl
                        label={property.title}
                        options={property.choices}
                        value={property.default as string | string[]}
                        onChange={property.handleChange}
                    />
                )
            } else if (configKey.includes("prompt_")) {
                return (
                    <PromptInput
                        key={property.title}
                        title={property.title}
                        value={property.default as string}
                        type={property.type}
                        onChange={property.handleChange}
                    />
                )
            }

        default:
            return (
                <div>
                    <Typography.Text>{property.title}</Typography.Text>
                </div>
            )
    }
}

export default memo(PlaygroundVariantPropertyControl)
