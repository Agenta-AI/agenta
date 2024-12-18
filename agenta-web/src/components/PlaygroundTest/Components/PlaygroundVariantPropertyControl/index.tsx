import {memo, useMemo} from "react"
import {Typography} from "antd"
import MinMaxControl from "./MinMaxControl"
import BooleanControl from "./BooleanControl"
import MultiSelectControl from "./MultiSelectControl"
import PromptInput from "./PromptInput"
import usePlaygroundVariantConfig from "../../hooks/usePlaygroundVariantConfig"

const PlaygroundVariantPropertyControl = ({
    configKey,
    valueKey,
    variantId,
}: {
    configKey: string
    valueKey: string
    variantId: string
}) => {
    const {mutateVariant, property} = usePlaygroundVariantConfig({
        configKey,
        valueKey,
        variantId,
    })

    console.log("render - PlaygroundVariantPropertyControl", property.config.title)
 
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
                        value={property.valueInfo as number}
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
                    value={property.valueInfo as boolean}
                    onChange={property.handleChange}
                />
            )
        case "string":
            if (property.config.choices) {
                return (
                    <MultiSelectControl
                        label={property.config.title}
                        options={property.config.choices}
                        value={property.valueInfo as string | string[]}
                        onChange={property.handleChange}
                    />
                )
            } else if (property.config.key.includes("prompt_")) {
                return (
                    <PromptInput
                        key={property.config.title}
                        title={property.config.title}
                        value={property.valueInfo as string}
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
