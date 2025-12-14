import {useCallback, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useQueryParamState} from "@/oss/state/appState"
import {clearTraceParamAtom} from "@/oss/state/url"

import {closeSessionDrawerAtom, isDrawerOpenAtom} from "./store/sessionDrawerStore"
import TraceDrawerContent from "./components/SessionDrawerContent"

const SessionDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeSessionDrawerAtom)
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

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    return (
        <EnhancedDrawer
            closeIcon={null}
            title={null}
            open={open}
            onClose={closeDrawer}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            className="[&_.ant-drawer-body]:p-0 [&_.ant-drawer-header]:hidden"
            destroyOnHidden
        >
            {open && (
                <TraceDrawerContent
                    onClose={closeDrawer}
                    onToggleWidth={toggleWidth}
                    isExpanded={drawerWidth !== initialWidth}
                />
            )}
        </EnhancedDrawer>
    )
}

export default SessionDrawer
