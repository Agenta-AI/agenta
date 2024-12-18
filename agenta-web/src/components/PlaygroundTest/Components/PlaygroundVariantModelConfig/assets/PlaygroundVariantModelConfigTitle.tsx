import {memo} from "react"
import {Button, Typography} from "antd"
import { PlaygroundVariantModelConfigTitleProps } from "../types"


const PlaygroundVariantModelConfigTitle = ({
    handleReset,
}: PlaygroundVariantModelConfigTitleProps) => {
    return (
        <div className="flex items-center gap-6 justify-between">
            <Typography.Text className="text-[14px] leading-[22px] font-[500]">Model Parameters</Typography.Text>
            <Button onClick={handleReset}>Reset default</Button>
        </div>
    )
}

export default memo(PlaygroundVariantModelConfigTitle)
