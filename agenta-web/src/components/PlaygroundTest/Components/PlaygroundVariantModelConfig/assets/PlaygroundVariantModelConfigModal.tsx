import {memo} from "react"
import {Button} from "antd"
import {ConfigProperty} from "../../../state/types"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

interface PlaygroundVariantModelConfigModalProps {
    variantId: string
    properties: ConfigProperty[]
    handleSave: () => void
    handleClose: () => void
}

const PlaygroundVariantModelConfigModal = ({
    variantId,
    properties,
    handleSave,
    handleClose,
}: PlaygroundVariantModelConfigModalProps) => {
    return (
        <div>
            {properties.map((property) => (
                <PlaygroundVariantPropertyControl
                    variantId={variantId}
                    key={property.key}
                    configKey={property.configKey}
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
