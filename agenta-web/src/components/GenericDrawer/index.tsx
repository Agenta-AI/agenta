import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Drawer, Flex} from "antd"
import React, {ReactNode, useState} from "react"

type GenericDrawerProps = {
    expandable?: boolean
    headerExtra?: ReactNode
    mainContent: ReactNode
    sideContent?: ReactNode
    initialWidth?: number
} & React.ComponentProps<typeof Drawer>

const GenericDrawer = ({...props}: GenericDrawerProps) => {
    const initialWidth = props.initialWidth || 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

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
                                if (drawerWidth === initialWidth) {
                                    setDrawerWidth(1920)
                                } else {
                                    setDrawerWidth(initialWidth)
                                }
                            }}
                            type="text"
                            icon={
                                drawerWidth === initialWidth ? (
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
                {props.sideContent && (
                    <div className="w-[320px] h-full flex flex-col">{props.sideContent}</div>
                )}
                {props.mainContent}
            </div>
        </Drawer>
    )
}

export default GenericDrawer
