import {type FC} from "react"

import {LoadingOutlined} from "@ant-design/icons"
import {Spin} from "antd"
import clsx from "clsx"

const TypingIndicator: FC<{label?: string; className?: string; size?: "small" | "default"}> = ({
    label = "Generating response...",
    className,
    size = "default",
}) => {
    return (
        <div
            className={clsx("w-full px-3 py-2 rounded-md text-[13px] text-[#667085bf]", className)}
        >
            <Spin
                indicator={
                    <LoadingOutlined
                        style={{
                            fontSize: size === "small" ? 12 : 14,
                            color: "rgba(102,112,133,0.75)",
                        }}
                        spin
                    />
                }
                size={size === "small" ? "small" : "default"}
            />
            <span className="ml-2 align-middle">{label}</span>
        </div>
    )
}

export default TypingIndicator
