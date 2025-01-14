import {Typography} from "antd"
import {ChatTestViewProps} from "./types"

const ChatTestView = (props: ChatTestViewProps) => {
    return (
        <div>
            <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                ChatTestView
            </Typography.Text>
        </div>
    )
}

export default ChatTestView
