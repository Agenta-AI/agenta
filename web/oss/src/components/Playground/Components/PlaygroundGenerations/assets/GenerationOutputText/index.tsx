import {Typography} from "antd"
import clsx from "clsx"

import {GenerationOutputTextProps} from "./types"

const GenerationOutputText: React.FC<GenerationOutputTextProps> = ({
    text,
    type,
    isPlaceholder = false,
    className,
    ...props
}) => {
    return (
        <Typography.Text
            type={type}
            className={clsx([{"text-[#BDC7D1]": isPlaceholder}, className])}
            {...props}
        >
            {text}
        </Typography.Text>
    )
}

export default GenerationOutputText
