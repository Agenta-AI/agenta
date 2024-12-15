import {Button, type ButtonProps} from "antd"
import {Plus} from "@phosphor-icons/react"

interface AddButtonProps extends ButtonProps {
    label: string
}

const AddButton = ({label, ...props}: AddButtonProps) => {
    return (
        <Button variant="outlined" color="default" className="self-start" {...props}>
            <Plus size={14} />
            {label}
        </Button>
    )
}

export default AddButton
