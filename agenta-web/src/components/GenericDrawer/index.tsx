import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Drawer, Flex} from "antd"
import React, {ReactNode, useState} from "react"
import TraceTree from "../pages/observability/drawer/TraceTree"
import TraceContent from "../pages/observability/drawer/TraceContent"

type GenericDrawerProps = {
    expandable?: boolean
    headerExtra?: ReactNode
} & React.ComponentProps<typeof Drawer>

const GenericDrawer = ({...props}: GenericDrawerProps) => {
    const [drawerWidth, setDrawerWidth] = useState(1200)

    return (
        <Drawer
            closeIcon={null}
            destroyOnClose
            width={drawerWidth}
            title={
                <Flex gap={12} justify="space-between" align="center">
                    <Button
                        onClick={() => props.onClose?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />

                    {props.expandable && (
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
                    )}

                    <div className="flex-1">{props.headerExtra}</div>
                </Flex>
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

export default GenericDrawer
