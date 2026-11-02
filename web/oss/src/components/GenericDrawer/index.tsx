import {useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Flex, Splitter} from "antd"

import {GenericDrawerProps} from "./types"

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
            closable={false}
            destroyOnHidden
            width={drawerWidth}
            title={
                <Flex gap={12} justify="space-between" align="center">
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

                    {/* Close sits last, at the right edge, where the shared SheetHeader puts it. */}
                    <Button
                        onClick={() => props.onClose?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label="Close"
                        {...props.closeButtonProps}
                    />
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
