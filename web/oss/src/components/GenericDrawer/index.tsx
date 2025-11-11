import {useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Flex, Splitter} from "antd"

import EnhancedDrawer from "../EnhancedUIs/Drawer"

import {GenericDrawerProps} from "./types"

const GenericDrawer = ({...props}: GenericDrawerProps) => {
    const initialWidth = props.initialWidth || 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    return (
        <EnhancedDrawer
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
            <Splitter className="h-full" key={props.externalKey}>
                {props.sideContent && (
                    <Splitter.Panel defaultSize={320} collapsible>
                        {props.sideContent}
                    </Splitter.Panel>
                )}
                <Splitter.Panel>{props.mainContent}</Splitter.Panel>
                {props.extraContent && (
                    <Splitter.Panel defaultSize={320} collapsible>
                        {props.extraContent}
                    </Splitter.Panel>
                )}
            </Splitter>
        </EnhancedDrawer>
    )
}

export default GenericDrawer
