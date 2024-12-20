import {memo, useCallback, type MouseEvent} from "react"
import {Button} from "antd"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import type { PlaygroundVariantModelConfigModalProps } from "../types"
import type { Path } from "../../../types/pathHelpers"
import type { StateVariant } from "../../../state/types"

const PlaygroundVariantModelConfigModal = ({
    variantId,
    properties,
    handleSave,
    handleClose,
}: PlaygroundVariantModelConfigModalProps) => {
    console.log("render PlaygroundVariantModelConfigModal")
    const preventClickBubble = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    console.log('properties', properties)
    return (
        <div onClick={preventClickBubble}>
            {properties.map((property) => (
                <PlaygroundVariantPropertyControl
                    variantId={variantId}
                    key={property.key}
                    configKey={property.configKey as Path<StateVariant>}
                    valueKey={property.valueKey as Path<StateVariant>}
                />
            ))}

            <div className="flex items-center justify-end gap-2 mt-4">
                <Button onClick={handleClose}>Cancel</Button>
                <Button onClick={handleSave} variant="solid" color="default">
                    Save
                </Button>
            </div>
        </div>
    )
}

export default memo(PlaygroundVariantModelConfigModal)
