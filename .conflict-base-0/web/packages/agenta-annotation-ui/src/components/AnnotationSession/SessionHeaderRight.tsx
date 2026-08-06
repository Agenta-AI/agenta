import {memo} from "react"

import {Tabs} from "antd"

import {TAB_ITEMS} from "./assets/constants"
import type {SessionHeaderRightProps} from "./assets/type"

const SessionHeaderRight = memo(function SessionHeaderRight({
    activeView,
    onTabChange,
}: SessionHeaderRightProps) {
    return (
        <div className="flex items-center gap-4">
            <Tabs
                activeKey={activeView}
                onChange={onTabChange}
                items={TAB_ITEMS}
                className="[&_.ant-tabs-nav]:!mb-0"
                size="small"
            />
        </div>
    )
})

export default SessionHeaderRight
