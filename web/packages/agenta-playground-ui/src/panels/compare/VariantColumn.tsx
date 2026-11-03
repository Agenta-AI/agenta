import {useCallback} from "react"

import {playgroundController} from "@agenta/playground"
import {useStore} from "jotai"

import {VariantCard} from "./VariantCard"

export interface VariantColumnProps {
    revisionIds: string[]
    onClose: (revisionId: string) => void
    onShow: (revisionId: string) => void
}

/**
 * The lead column of the compare view's config area: one card per revision, in column order.
 * Moving a card moves its config column and its output column; the test cases stay.
 */
export const VariantColumn = ({revisionIds, onClose, onShow}: VariantColumnProps) => {
    const store = useStore()
    const move = useCallback(
        (revisionId: string, step: -1 | 1) => {
            const ids = [...store.get(playgroundController.selectors.entityIds())]
            const from = ids.indexOf(revisionId)
            const to = from + step
            if (from < 0 || to < 0 || to >= ids.length) return
            ;[ids[from], ids[to]] = [ids[to], ids[from]]
            store.set(playgroundController.actions.setEntityIds, ids)
        },
        [store],
    )

    return (
        <section className="flex flex-col">
            <h2 className="sticky top-0 z-[1] m-0 flex h-12 items-center border-0 border-b border-solid border-border bg-background px-3 text-sm font-semibold">
                Variants
            </h2>
            <div className="flex flex-col gap-3 p-3">
                {revisionIds.map((revisionId, index) => (
                    <VariantCard
                        key={revisionId}
                        revisionId={revisionId}
                        index={index}
                        count={revisionIds.length}
                        onMove={move}
                        onClose={onClose}
                        onShow={onShow}
                    />
                ))}
            </div>
        </section>
    )
}
