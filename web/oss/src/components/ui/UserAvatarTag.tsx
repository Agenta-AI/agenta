import {Tag} from "antd"
import React from "react"
import Avatar from "../Avatar/Avatar"

interface UserAvatarTagProps {
    modifiedBy: string
}

const UserAvatarTag = ({modifiedBy}: UserAvatarTagProps) => {
    return (
        <Tag bordered={false}>
            <Avatar name={modifiedBy} className="w-4 h-4 text-[9px]" /> {modifiedBy}
        </Tag>
    )
}

export default UserAvatarTag
