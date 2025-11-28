import {useCallback, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useQueryParamState} from "@/oss/state/appState"
import {clearTraceParamAtom} from "@/oss/state/url"

import {isDrawerOpenAtom, closeTraceDrawerAtom} from "./store/traceDrawerStore"
import TraceDrawerContent from "./TraceDrawerContent"

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const clearTraceParam = useSetAtom(clearTraceParamAtom)
    const [, setSpanQueryParam] = useQueryParamState("span")

    const initialWidth = 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (!isOpen) {
                clearTraceParam()
                setSpanQueryParam(undefined, {shallow: true})
            }
        },
        [clearTraceParam, setSpanQueryParam],
    )

    const header = (
        <div className="flex items-center gap-3">
            <Button onClick={() => closeDrawer()} type="text" icon={<CloseOutlined />} />

            <Button
                onClick={() =>
                    setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
                }
                type="text"
                icon={
                    drawerWidth === initialWidth ? (
                        <FullscreenOutlined />
                    ) : (
                        <FullscreenExitOutlined />
                    )
                }
            />
        </div>
    )

    return (
        <EnhancedDrawer
            closeIcon={null}
            title={header}
            open={open}
            onClose={closeDrawer}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            className="[&_.ant-drawer-body]:p-0"
            destroyOnClose
        >
            {open && <TraceDrawerContent />}
        </EnhancedDrawer>
    )
}

export default TraceDrawer
