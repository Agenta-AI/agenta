import {CloudArrowUp} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"

interface DeployButtonProps extends ButtonProps {
    label?: string
}

const DeployButton = ({label, type = "text", ...props}: DeployButtonProps) => {
    return (
        <Button icon={<CloudArrowUp size={14} />} type={type} {...props}>
            {label}
        </Button>
    )
}

export default DeployButton
