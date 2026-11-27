import {memo, useMemo} from "react"

import {getColorPairFromStr, getInitials} from "@agenta/ui/components/presentational"
import {AvatarBox, type AvatarBoxProps} from "@agenta/ui/ui"

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
        <AvatarBox style={{...colorStyle, ...style}} {...props}>
            {getInitials(name)}
        </AvatarBox>
    )
})

InitialsAvatar.displayName = "InitialsAvatar"
