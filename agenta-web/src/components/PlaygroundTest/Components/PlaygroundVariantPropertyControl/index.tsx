import {memo} from "react"
import {Typography} from "antd"
import MinMaxControl from "./assets/MinMaxControl"
import BooleanControl from "./assets/BooleanControl"
import MultiSelectControl from "./assets/MultiSelectControl"
import SimpleDropdownSelect from "./assets/SimpleDropdownSelect"
import PromptMessageContent from "./assets/PromptMessageContent"
import type {PlaygroundVariantPropertyControlProps} from "./types"
import type {PropertyMetadata} from "../../betterTypes/types"
import usePlayground from "../../hooks/usePlayground"

// Type-safe render functions for each metadata type
type RenderFunctions = {
    [K in PropertyMetadata["type"]]: (
        metadata: Extract<PropertyMetadata, { type: K }>,
        value: any,
        handleChange: (v: any) => void,
        as?: string
    ) => React.ReactNode
}

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
    )},
    
    boolean: (metadata, value, handleChange) => (
        <BooleanControl
            label={metadata.title || ""}
            value={value}
            onChange={handleChange}
        />
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
    },
    
    array: (metadata, value, handleChange) => {
        if (!Array.isArray(value?.value)) return null;
        
        return (
            <div className="flex flex-col gap-2">
                {value.value.map((item) => (
                    <div key={item.__id}>
                        {renderMap[item.__metadata.type](
                            item.__metadata,
                            item.value,
                            (newValue) => {
                                const newArray = [...value.value];
                                const index = value.value.findIndex(v => v.__id === item.__id);
                                newArray[index] = { ...item, value: newValue };
                                handleChange({ value: newArray });
                            }
                        )}
                    </div>
                ))}
            </div>
        );
    },

    object: () => <Typography.Text>Object input not implemented</Typography.Text>,
    compound: (metadata) => {
        return <Typography.Text>Compound input not implemented</Typography.Text>
    },
} as const

const PlaygroundVariantPropertyControl: React.FC<PlaygroundVariantPropertyControlProps> = ({
    propertyId,
    variantId,
    className,
    as,
}) => {
    console.log(
        "usePlayground[%cComponent%c] - PlaygroundVariantPropertyControl - RENDER!",
        "color: orange",
        "",
        variantId,
        propertyId
    )
    
    const {variantConfigProperty: property} = usePlayground({
        variantId,
        propertyId,
        hookId: "PlaygroundVariantPropertyControl",
    })
    
    if (!property) return null

    const {__metadata: metadata, value, handleChange} = property

    const renderer = renderMap[metadata.type]
    if (renderer) {
        return renderer(metadata as any, value, handleChange, as)
    }

    return <Typography.Text>Unknown type: {metadata.type}</Typography.Text>
}

export default memo(PlaygroundVariantPropertyControl)
