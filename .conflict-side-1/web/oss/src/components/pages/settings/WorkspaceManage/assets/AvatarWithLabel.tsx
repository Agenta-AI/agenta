import {InitialsAvatar} from "@agenta/ui"
import {Space, Typography} from "antd"

const AvatarWithLabel = ({name}: {name: string | undefined}) => {
    return (
        <Space>
            <InitialsAvatar size="small" name={name as string} />

            <Typography.Text>{name}</Typography.Text>
        </Space>
    )
}

export default AvatarWithLabel
