import {memo} from "react"

import {Button, Input, type InputProps} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"

export interface ModelNameInputProps extends InputProps {
    onDelete: () => void
}

const ModelNameInput = ({onDelete, disabled, ...props}: ModelNameInputProps) => {
    return (
        <div className="w-full relative">
            <Input
                placeholder="Enter model name"
                className="w-full"
                disabled={disabled}
                {...props}
            />
            <Button
                variant="link"
                size="icon"
                className="absolute top-[1px] right-1"
                onClick={onDelete}
                disabled={disabled}
                aria-label="Remove model"
            >
                <Trash size={14} />
            </Button>
        </div>
    )
}

export default memo(ModelNameInput)
