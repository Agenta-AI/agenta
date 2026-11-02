import {RevisionDrawer, type RevisionDrawerProps} from "@agenta/entity-ui/variant"

import {useRevisionParam} from "./useRevisionParam"

/**
 * The revision drawer bound to the URL. Pages load this file with `next/dynamic` and
 * `{ssr: false}`, and render it only after a revision is first opened, so the drawer code
 * costs nothing until then.
 */
export const RevisionDrawerHost = (
    props: Pick<RevisionDrawerProps, "kind" | "navigationIds" | "actions">,
) => {
    const [revisionId, setRevisionId] = useRevisionParam()
    return (
        <RevisionDrawer
            {...props}
            revisionId={revisionId}
            onClose={() => setRevisionId(null)}
            onNavigate={setRevisionId}
        />
    )
}
