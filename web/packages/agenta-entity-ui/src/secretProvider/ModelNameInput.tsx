import {memo} from "react"

import {Trash} from "@phosphor-icons/react"
import {Button, Input} from "antd"
import type {InputProps} from "antd"

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
                icon={<Trash size={14} />}
                type="link"
                className="absolute top-[1px] right-1"
                onClick={onDelete}
                disabled={disabled}
            />
        </div>
    )
}

export default memo(ModelNameInput)
