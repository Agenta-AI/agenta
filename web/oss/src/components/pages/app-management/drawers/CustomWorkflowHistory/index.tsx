import {Drawer} from "antd"
import React from "react"
import {CustomWorkflowHistoryProps} from "./types"
import ConfigurationTable from "./components/ConfigurationTable"
import ConfigurationView from "./components/ConfigurationView"
import clsx from "clsx"

const CustomWorkflowHistory = ({...props}: CustomWorkflowHistoryProps) => {
    return (
        <Drawer title="Configuration History" width={1200} {...props}>
            <div className={clsx(["flex gap-6 p-6"])}>
                <ConfigurationTable />
                <ConfigurationView />
            </div>
        </Drawer>
    )
}

export default CustomWorkflowHistory
