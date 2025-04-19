import {Drawer} from "antd"
import clsx from "clsx"

import ConfigurationTable from "./components/ConfigurationTable"
import ConfigurationView from "./components/ConfigurationView"
import {CustomWorkflowHistoryProps} from "./types"

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
