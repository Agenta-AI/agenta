import {ExportOutlined} from "@ant-design/icons"
import {Button} from "antd"

interface SecondaryBtnProps {
    children: React.ReactNode
    disabled: boolean
    onClick: () => void
}

const SecondaryButton: React.FC<SecondaryBtnProps> = ({children, ...props}) => {
    return (
        <Button {...props} icon={<ExportOutlined />} size="large">
            {children}
        </Button>
    )
}

export default SecondaryButton
