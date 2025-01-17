import {Button, type ButtonProps} from "antd"
import {Plus} from "@phosphor-icons/react"

interface AddButtonProps extends ButtonProps {
    label?: string
}

const AddButton = ({label, ...props}: AddButtonProps) => {
    return (
        <Button
            variant="outlined"
            color="default"
            icon={<Plus size={14} />}
            className="self-start"
            {...props}
        >
            {label}
        </Button>
    )
}

export default AddButton
