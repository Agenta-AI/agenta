import dynamic from "next/dynamic"

import {useRevisionParam} from "../revisions/useRevisionParam"

// The drawer is a separate chunk: nothing of it loads until a reader opens an evaluator.
const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((m) => m.RevisionDrawerHost),
    {ssr: false},
)

/** The read-only evaluator drawer, bound to `?revisionId=`. Drawn only while a revision is open. */
export const EvaluatorsDrawer = ({navigationIds}: {navigationIds: readonly string[]}) => {
    const [revisionId] = useRevisionParam()
    if (!revisionId) return null
    return <RevisionDrawerHost kind="evaluator" navigationIds={navigationIds} />
}
