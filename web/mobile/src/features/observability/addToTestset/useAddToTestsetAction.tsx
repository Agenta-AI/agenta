import {useState} from "react"

import dynamic from "next/dynamic"

import {useAddToTestsetAccess} from "./useAddToTestsetAccess"

// The sheet is its own chunk: the traces page loads it on the first click only.
const AddToTestsetSheet = dynamic(() => import("./AddToTestsetSheet"), {ssr: false})

/**
 * The "Add to testset" action and the sheet it opens, for the traces toolbar (the selected rows;
 * table row keys are span ids) and the trace drawer button (the active span).
 */
export const useAddToTestsetAction = (projectId: string, selectedSpanIds: readonly string[]) => {
    const allowed = useAddToTestsetAccess(projectId)
    const [openFor, setOpenFor] = useState<readonly string[] | null>(null)

    const testsetAction = allowed
        ? {
              disabled: selectedSpanIds.length === 0,
              onSelect: () => setOpenFor([...selectedSpanIds]),
          }
        : undefined

    const sheet = openFor ? (
        <AddToTestsetSheet spanIds={openFor} onClose={() => setOpenFor(null)} />
    ) : null

    return {testsetAction, sheet}
}
