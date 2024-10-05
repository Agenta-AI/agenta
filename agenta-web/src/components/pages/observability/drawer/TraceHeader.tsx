import {JSSTheme} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

const TraceHeader = () => {
    const classes = useStyles()

    return (
        <div className="flex items-center justify-between">
            <Space>
                <div>
                    <Button onClick={() => {}} type="text" icon={<CaretUp size={16} />} />
                    <Button onClick={() => {}} type="text" icon={<CaretDown size={16} />} />
                </div>

                <Typography.Text className={classes.title}>Trace</Typography.Text>

                <Tag className="font-normal"># 66c5b76d6165af12bab569e9</Tag>
            </Space>

            <Button icon={<DeleteOutlined />} />
        </div>
    )
}

export default TraceHeader
