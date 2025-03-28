import {Avatar as MainAvatar} from "antd"

import {getColorPairFromStr} from "@/oss/lib/helpers/colors"
import {getInitials} from "@/oss/lib/helpers/utils"

type Props = {
    name: string
} & React.ComponentProps<typeof MainAvatar>

const Avatar: React.FC<Props> = ({name, ...props}) => {
    const color = getColorPairFromStr(name || "")

    return (
        <MainAvatar
            shape="square"
            style={{
                backgroundColor: color.backgroundColor,
                color: color.textColor,
            }}
            {...props}
        >
            {getInitials(name)}
        </MainAvatar>
    )
}

export default Avatar
