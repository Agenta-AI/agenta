import {JSSTheme} from "@/lib/Types"
import {
    CloseOutlined,
    DeleteOutlined,
    FullscreenExitOutlined,
    FullscreenOutlined,
} from "@ant-design/icons"
import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Drawer, Space, Tag, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import TraceTree from "./TraceTree"
import TraceContent from "./TraceContent"

type TraceDrawerProps = {} & React.ComponentProps<typeof Drawer>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

const TraceDrawer = ({...props}: TraceDrawerProps) => {
    const classes = useStyles()
    const [drawerWidth, setDrawerWidth] = useState(1200)

    return (
        <Drawer
            closeIcon={null}
            destroyOnClose
            width={drawerWidth}
            title={
                <div className="flex items-center justify-between">
                    <Space size={12}>
                        <Button
                            onClick={() => props.onClose?.({} as any)}
                            type="text"
                            icon={<CloseOutlined />}
                        />

                        <Button
                            onClick={() => {
                                if (drawerWidth === 1200) {
                                    setDrawerWidth(1920)
                                } else {
                                    setDrawerWidth(1200)
                                }
                            }}
                            type="text"
                            icon={
                                drawerWidth === 1200 ? (
                                    <FullscreenOutlined />
                                ) : (
                                    <FullscreenExitOutlined />
                                )
                            }
                        />

                        <Space>
                            <div>
                                <Button
                                    onClick={() => {}}
                                    type="text"
                                    icon={<CaretUp size={16} />}
                                />
                                <Button
                                    onClick={() => {}}
                                    type="text"
                                    icon={<CaretDown size={16} />}
                                />
                            </div>

                            <Typography.Text className={classes.title}>Trace</Typography.Text>

                            <Tag className="font-normal"># 66c5b76d6165af12bab569e9</Tag>
                        </Space>
                    </Space>

                    <Button icon={<DeleteOutlined />} />
                </div>
            }
            {...props}
        >
            <div className="flex h-full">
                <TraceTree />
                <TraceContent />
            </div>
        </Drawer>
    )
}

export default TraceDrawer
