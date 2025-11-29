import {memo, useCallback} from "react"

import {CheckCircleOutlined} from "@ant-design/icons"
import {Typography} from "antd"
import clsx from "clsx"

import {TabLabelProps} from "./types"

const TabLabel = ({children, tabTitle, completed, className, id, ...rest}: TabLabelProps) => {
    const assignRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node || !id) return

            const ensureId = (attempt = 0) => {
                const tabElement = node.closest(".ant-tabs-tab")
                if (tabElement) {
                    tabElement.setAttribute("id", id)
                    return
                }
                if (attempt >= 5) return
                setTimeout(() => ensureId(attempt + 1), 50)
            }

            ensureId()
        },
        [id],
    )

    return (
        <div
            {...rest}
            ref={assignRef}
            className={clsx("flex flex-col w-full items-start gap-2", className)}
        >
            <div className="flex items-center gap-1 w-full">
                <Typography.Text className="!my-0">{tabTitle}</Typography.Text>
                {completed ? <CheckCircleOutlined style={{color: "green"}} /> : null}
            </div>
            {completed && <div className="flex flex-col gap-1 w-full">{children}</div>}
        </div>
    )
}

export default memo(TabLabel)
