import {useCallback, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {clearTraceParamAtom} from "@/oss/state/url"

import {isDrawerOpenAtom, closeTraceDrawerAtom} from "./store/traceDrawerStore"
import TraceDrawerContent from "./TraceDrawerContent"

const initialWidth = 1200

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const clearTraceParam = useSetAtom(clearTraceParamAtom)

    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (!isOpen) {
                clearTraceParam()
            }
        },
        [clearTraceParam],
    )

    return (
        <EnhancedDrawer
            closeIcon={null}
            title={null}
            open={open}
            onClose={closeDrawer}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            className="[&_.ant-drawer-body]:p-0"
        >
            {open ? (
                <TraceDrawerContent
                    drawerWidth={drawerWidth}
                    setDrawerWidth={(updater) => setDrawerWidth((prev) => updater(prev))}
                    onClose={closeDrawer}
                />
            ) : null}
        </EnhancedDrawer>
    )
}

export default TraceDrawer
