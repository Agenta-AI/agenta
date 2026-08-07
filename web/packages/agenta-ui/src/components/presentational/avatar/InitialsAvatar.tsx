import {memo, useMemo} from "react"

import {AvatarBox, type AvatarBoxProps} from "../../ui/avatar"

import {getColorPairFromStr, getInitials} from "./utils"

export interface InitialsAvatarProps extends Omit<AvatarBoxProps, "children"> {
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
        <AvatarBox shape="square" style={{...colorStyle, ...style}} {...props}>
            {getInitials(name)}
        </AvatarBox>
    )
})

InitialsAvatar.displayName = "InitialsAvatar"
