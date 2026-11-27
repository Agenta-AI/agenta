import {Space, Typography} from "antd"

import {InitialsAvatar} from "@/oss/components/LegacyKit"

const AvatarWithLabel = ({name}: {name: string | undefined}) => {
    return (
        <Space>
            <InitialsAvatar size="small" name={name as string} />

            <Typography.Text>{name}</Typography.Text>
        </Space>
    )
}

export default AvatarWithLabel
