import {useState} from "react"

import {createQueueDrawerOpenAtom} from "@agenta/annotation"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

// The sheet, the evaluator picker and their data load on the first open, not with the page.
const CreateQueueSheet = dynamic(
    () => import("./CreateQueueSheet").then((module) => module.CreateQueueSheet),
    {ssr: false},
)

/**
 * Mount this once next to the trace drawer (or on the queue list). It costs one atom read until
 * `createQueueDrawerOpenAtom` first turns true. It must not sit inside a popover: the popover unmounts
 * its content on close and would take the sheet with it.
 */
export const CreateQueueSheetHost = () => {
    const open = useAtomValue(createQueueDrawerOpenAtom)
    // Once opened, the sheet stays mounted so it can play its closing motion.
    const [wasOpened, setWasOpened] = useState(open)
    if (open && !wasOpened) setWasOpened(true)
    return wasOpened ? <CreateQueueSheet /> : null
}
