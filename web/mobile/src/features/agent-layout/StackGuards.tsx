import {useEffect} from "react"

import {useViewStack} from "@agenta/ui/view-stack"
import {useSetAtom} from "jotai"

import {viewFormDirtyAtom} from "../chat/viewFormDirty"

import {useLeaveSource} from "./leaveGuard"

/** The view stack registers with the leave guard and tells open sessions a form has edits. */
export const StackGuards = () => {
    const stack = useViewStack()
    const setViewFormDirty = useSetAtom(viewFormDirtyAtom)
    useEffect(() => {
        setViewFormDirty(stack.dirty)
    }, [stack.dirty, setViewFormDirty])
    useEffect(() => () => setViewFormDirty(false), [setViewFormDirty])
    useLeaveSource({isDirty: () => stack.dirty, ask: () => stack.closeAll()})
    return null
}
