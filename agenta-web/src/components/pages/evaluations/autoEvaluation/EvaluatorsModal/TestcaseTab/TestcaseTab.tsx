import {JSSTheme} from "@/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface TestcaseTabProps {
    handleOnCancel: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
}))

const TestcaseTab = ({handleOnCancel}: TestcaseTabProps) => {
    const classes = useStyles()

    return (
        <div>
            <div className={classes.header}>
                <Typography.Text>Select test case</Typography.Text>

                <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
            </div>
        </div>
    )
}

export default TestcaseTab
