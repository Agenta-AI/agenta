import {Typography, Tag} from "antd"
import {type StateVariant} from "../../../state/types"

const PlaygroundVariantConfigHeader = ({variant}: {variant: StateVariant}) => {
    return (
        <div className="w-full bg-[#f5f7fa] h-10 flex items-center px-2.5 gap-2">
            <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                {variant.variantName}
            </Typography.Text>
            <Tag color="default" bordered={false} className="bg-[rgba(5,23,41,0.06)]">
                {`v${variant.revision}`}
            </Tag>
        </div>
    )
}

export default PlaygroundVariantConfigHeader
