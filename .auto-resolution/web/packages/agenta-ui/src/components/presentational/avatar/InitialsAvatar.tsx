import React, {memo, useMemo} from "react"

import {Avatar} from "antd"

import {getColorPairFromStr, getInitials} from "./utils"

export interface InitialsAvatarProps extends Omit<React.ComponentProps<typeof Avatar>, "children"> {
    name: string
}

export const InitialsAvatar = memo(({name, style, ...props}: InitialsAvatarProps) => {
    const colorStyle = useMemo(() => {
        const color = getColorPairFromStr(name || "")
        return {
            backgroundColor: color.backgroundColor,
            color: color.textColor,
        }
    }, [name])

    return (
        <Avatar shape="square" style={{...colorStyle, ...style}} {...props}>
            {getInitials(name)}
        </Avatar>
    )
})

InitialsAvatar.displayName = "InitialsAvatar"
