import {Space, Typography} from "antd"

import Avatar from "@/oss/components/Avatar/Avatar"

const AvatarWithLabel = ({name}: {name: string | undefined}) => {
    return (
        <Space>
            <Avatar size="small" name={name as string} />

            <Typography.Text>{name}</Typography.Text>
        </Space>
    )
}

export default AvatarWithLabel
