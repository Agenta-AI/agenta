import {useCallback, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useQueryParamState} from "@/oss/state/appState"
import {clearSessionParamAtom} from "@/oss/state/url/session"

import {closeSessionDrawerAtom, isDrawerOpenAtom} from "../store/sessionDrawerStore"

import SessionDrawerContent from "./SessionDrawerContent"

const SessionDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeSessionDrawerAtom)
    const clearSessionParam = useSetAtom(clearSessionParamAtom)
    const [, setSpanQueryParam] = useQueryParamState("span")

    const initialWidth = 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (!isOpen) {
                clearSessionParam()
                setSpanQueryParam(undefined, {shallow: true})
            }
        },
        [clearSessionParam, setSpanQueryParam],
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
                <SessionDrawerContent
                    onClose={closeDrawer}
                    onToggleWidth={toggleWidth}
                    isExpanded={drawerWidth !== initialWidth}
                />
            )}
        </EnhancedDrawer>
    )
}

export default SessionDrawer
