import {type ReactNode, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, type ButtonProps, type DrawerProps, Flex, Splitter} from "antd"

import EnhancedDrawer from "./EnhancedDrawer"

export interface GenericDrawerProps extends DrawerProps {
    expandable?: boolean
    expandButtonProps?: ButtonProps
    headerExtra?: ReactNode
    mainContent: ReactNode
    extraContent?: ReactNode
    sideContent?: ReactNode
    initialWidth?: number
    externalKey?: string
    sideContentDefaultSize?: number
    mainContentDefaultSize?: number
    extraContentDefaultSize?: number
    closeOnLayoutClick?: boolean
    closeButtonProps?: ButtonProps
}

const GenericDrawer = ({
    sideContentDefaultSize = 320,
    mainContentDefaultSize = 640,
    extraContentDefaultSize = 320,
    ...props
}: GenericDrawerProps) => {
    const initialWidth = props.initialWidth || 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    return (
        <EnhancedDrawer
            closeIcon={null}
            destroyOnHidden
            size={drawerWidth}
            title={
                <Flex gap={12} justify="space-between" align="center">
                    <Button
                        onClick={() => props.onClose?.({} as React.MouseEvent)}
                        type="text"
                        icon={<CloseOutlined />}
                        {...props.closeButtonProps}
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
                            {...props.expandButtonProps}
                        />
                    )}

                    <div className="flex-1">{props.headerExtra}</div>
                </Flex>
            }
            {...props}
        >
            <Splitter className="h-full" key={props.externalKey}>
                {props.sideContent && (
                    <Splitter.Panel defaultSize={sideContentDefaultSize} collapsible>
                        {props.sideContent}
                    </Splitter.Panel>
                )}
                <Splitter.Panel min={400} defaultSize={mainContentDefaultSize}>
                    {props.mainContent}
                </Splitter.Panel>
                {props.extraContent && (
                    <Splitter.Panel min={200} defaultSize={extraContentDefaultSize} collapsible>
                        {props.extraContent}
                    </Splitter.Panel>
                )}
            </Splitter>
        </EnhancedDrawer>
    )
}

export default GenericDrawer
