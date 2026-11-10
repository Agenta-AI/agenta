import dynamic from "next/dynamic"

import {evaluatorPlaygroundHref} from "../playground/playgroundUrl"
import {OpenInPlaygroundButton} from "../revisions/OpenInPlaygroundButton"
import {useRevisionParam} from "../revisions/useRevisionParam"

// The drawer is a separate chunk: nothing of it loads until a reader opens an evaluator.
const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((m) => m.RevisionDrawerHost),
    {ssr: false},
)

/**
 * The read-only evaluator drawer, bound to `?revisionId=`. Drawn only while a revision is open.
 * With `playgroundBase` (the evaluator playground view is on), it links to the evaluator playground.
 */
export const EvaluatorsDrawer = ({
    navigationIds,
    playgroundBase,
}: {
    navigationIds: readonly string[]
    playgroundBase?: string | null
}) => {
    const [revisionId] = useRevisionParam()
    if (!revisionId) return null
    return (
        <RevisionDrawerHost
            kind="evaluator"
            navigationIds={navigationIds}
            actions={
                playgroundBase ? (
                    <OpenInPlaygroundButton
                        href={evaluatorPlaygroundHref(playgroundBase, revisionId)}
                    />
                ) : null
            }
        />
    )
}
