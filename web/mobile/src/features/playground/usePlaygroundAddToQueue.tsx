import {useCallback, type ReactNode} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {Button} from "@agenta/ui/ui"
import {ListChecks} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

// The picker and its queue list load when a user first opens the focus drawer's control.
const AddToQueuePicker = dynamic(() => import("../annotations/AddToQueuePicker"), {ssr: false})

/**
 * The focus drawer's "Add to queue" for the open test case. Only a test case of a connected test
 * set can go to a queue: a local row has no id the server knows, so it gets none (as in /w).
 */
export const usePlaygroundAddToQueue = (
    loadableId: string,
): ((itemIds: string[]) => ReactNode) | undefined => {
    const mode = useAtomValue(loadableController.selectors.mode(loadableId))
    const source = useAtomValue(loadableController.selectors.connectedSource(loadableId))
    const render = useCallback(
        (itemIds: string[]) => (
            <AddToQueuePicker
                itemType="testcases"
                itemIds={itemIds}
                disabled={itemIds.length === 0}
            >
                <Button size="sm" variant="outline" disabled={itemIds.length === 0}>
                    <ListChecks aria-hidden size={14} />
                    Add to queue
                </Button>
            </AddToQueuePicker>
        ),
        [],
    )
    return mode === "connected" && source.type === "testcase" ? render : undefined
}
