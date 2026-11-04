import {useEffect, useState} from "react"

import {
    isplaygroundFocusDrawerOpenAtom,
    resetPlaygroundFocusDrawerAtom,
} from "@agenta/playground-ui/state"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {usePlaygroundTraceFooter} from "./usePlaygroundTraceFooter"

// The drawer code downloads when a user first opens a test case.
const FocusDrawer = dynamic(
    () => import("@agenta/playground-ui/panels/focus").then((module) => module.FocusDrawer),
    {ssr: false},
)

/** Mounts the focus drawer after its first open, and closes and resets it when the page unmounts. */
export const PlaygroundFocusDrawerHost = () => {
    const isOpen = useAtomValue(isplaygroundFocusDrawerOpenAtom)
    const reset = useSetAtom(resetPlaygroundFocusDrawerAtom)
    const renderTraceFooter = usePlaygroundTraceFooter()
    const [opened, setOpened] = useState(false)

    useEffect(() => {
        if (isOpen) setOpened(true)
    }, [isOpen])
    useEffect(() => reset, [reset])

    return opened ? <FocusDrawer renderTraceFooter={renderTraceFooter} /> : null
}
