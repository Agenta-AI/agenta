import {forwardRef} from "react"

import clsx from "clsx"
import {Button, type ButtonProps} from "antd"
import {Plus} from "@phosphor-icons/react"

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
