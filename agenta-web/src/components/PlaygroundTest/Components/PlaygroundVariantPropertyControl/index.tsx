import {memo, useMemo} from "react"
import {Typography} from "antd"
import MinMaxControl from "./MinMaxControl"
import BooleanControl from "./BooleanControl"
import MultiSelectControl from "./MultiSelectControl"
import PromptInput from "./PromptInput"
import usePlaygroundVariantConfig from "../../hooks/usePlaygroundVariantConfig"

const PlaygroundVariantPropertyControl = ({
    configKey,
    variantId,
}: {
    configKey: string
    variantId: string
}) => {
    const {mutateVariant, config: _config} = usePlaygroundVariantConfig({
        configKey,
        variantId,
    })

    const property = useMemo(() => {
        /**
         * A generic function that updates a variant prompt's parameters
         * @param e
         * @param param
         */
        interface HandleParamUpdateEvent {
            target: {
                value: string | boolean | string[] | null | number
            }
        }

        const handleParamUpdate = (
            e: HandleParamUpdateEvent | string | boolean | string[] | null | number,
        ) => {
            const val = !!e
                ? Array.isArray(e)
                    ? e
                    : typeof e === "object"
                      ? e.target.value
                      : e
                : null
            console.log("handle param update", val)
            mutateVariant(variantId, val)
        }

        return {
            config: _config.config || _config,
            valueInfo: _config.config ? _config : {},
            handleChange: (
                e: HandleParamUpdateEvent | string | boolean | string[] | null | number,
            ) => handleParamUpdate(e),
        }
    }, [_config])

    console.log("render property", configKey)

    switch (property.config.type) {
        case "number":
        case "integer":
            if (!Number.isNaN(property.config.minimum) && !Number.isNaN(property.config.maximum)) {
                return (
                    <MinMaxControl
                        label={property.config.title}
                        min={property.config.minimum}
                        max={property.config.maximum}
                        step={0.1}
                        value={property.valueInfo.value as number}
                        onChange={property.handleChange}
                    />
                )
            } else {
                return (
                    <div>
                        <Typography.Text>{property.config.title}</Typography.Text>
                        number
                    </div>
                )
            }
        case "boolean":
            return (
                <BooleanControl
                    label={property.config.title}
                    value={property.valueInfo.value as boolean}
                    onChange={property.handleChange}
                />
            )
        case "string":
            if (property.config.choices) {
                return (
                    <MultiSelectControl
                        label={property.config.title}
                        options={property.config.choices}
                        value={property.valueInfo.value as string | string[]}
                        onChange={property.handleChange}
                    />
                )
            } else if (property.config.key.includes("prompt_")) {
                return (
                    <PromptInput
                        key={property.config.title}
                        title={property.config.title}
                        value={property.valueInfo.value as string}
                        type={property.config.type}
                        onChange={property.handleChange}
                    />
                )
            }

        default:
            return (
                <div>
                    <Typography.Text>{property.config.title}</Typography.Text>
                </div>
            )
    }
}

export default memo(PlaygroundVariantPropertyControl)
