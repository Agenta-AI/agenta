import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Trash} from "@phosphor-icons/react"
import {Input} from "antd"

import {ModelNameInputProps} from "./types"

const ModelNameInput = ({onDelete, disabled, ...props}: ModelNameInputProps) => {
    return (
        <div className="w-full relative">
            <Input placeholder="Enter model name" className="w-full" {...props} />
            <Button
                className="absolute top-[1px] right-1"
                onClick={onDelete}
                disabled={disabled}
                variant="link"
                size="icon"
            >
                {<Trash size={14} />}
            </Button>
        </div>
    )
}

export default memo(ModelNameInput)
