import type {ComponentProps} from "react"

import {CompareLayout} from "@agenta/playground-ui/panels/compare"

import {RevisionConfig} from "./RevisionConfig"
import {useCloseRevision} from "./useCloseRevision"
import {usePlaygroundTraceFooter} from "./usePlaygroundTraceFooter"

type ColumnProps = Omit<
    ComponentProps<typeof RevisionConfig>,
    "revisionId" | "readOnly" | "onClose"
>

/**
 * The compare view: two or more revisions side by side. It loads on demand, the first time the
 * page shows more than one revision.
 */
export const PlaygroundCompare = ({
    revisionIds,
    deletedId,
    column,
}: {
    revisionIds: string[]
    /** A revision the server deleted, read only until it leaves the page. */
    deletedId: string | null
    column: ColumnProps
}) => {
    const {close, modal} = useCloseRevision()
    const renderTraceFooter = usePlaygroundTraceFooter()

    return (
        <>
            <CompareLayout
                revisionIds={revisionIds}
                onClose={close}
                renderTraceFooter={renderTraceFooter}
                renderConfig={(revisionId) => (
                    <RevisionConfig
                        {...column}
                        revisionId={revisionId}
                        readOnly={deletedId === revisionId}
                        onClose={close}
                    />
                )}
            />
            {modal}
        </>
    )
}
