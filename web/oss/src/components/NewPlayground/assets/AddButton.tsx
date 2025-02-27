import {forwardRef} from "react"

import {Plus} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"
import clsx from "clsx"

interface AddButtonProps extends ButtonProps {
    label?: string
}

const AddButton = forwardRef<HTMLButtonElement, AddButtonProps>(
    ({label, className, ...props}: AddButtonProps, ref) => {
        return (
            <Button
                ref={ref}
                variant="outlined"
                color="default"
                icon={<Plus size={14} />}
                className={clsx(["self-start"], className)}
                {...props}
            >
                {label}
            </Button>
        )
    },
)

export default AddButton
