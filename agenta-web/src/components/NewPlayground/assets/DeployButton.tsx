import {Button, type ButtonProps} from "antd"
import {Rocket} from "@phosphor-icons/react"

interface DeployButtonProps extends ButtonProps {
    label?: string
}

const DeployButton = ({label, type = "text", ...props}: DeployButtonProps) => {
    return (
        <Button icon={<Rocket size={14} />} type={type} {...props}>
            {label}
        </Button>
    )
}

export default DeployButton
