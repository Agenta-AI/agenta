import {CommitVariantChangesButton as CommitVariantChangesButtonView} from "@agenta/playground-ui/commit"
import type {CommitVariantChangesButtonProps} from "@agenta/playground-ui/commit"

import {useCommitHostAdapter} from "../useCommitHostAdapter"

/**
 * App adapter over the shared commit button: the commit itself is the package's, and what this
 * app adds are its own out-of-band caches (the variant registry and evaluator tables, which do
 * not live in the entities layer) plus the onboarding event — see `useCommitHostAdapter`.
 */
const CommitVariantChangesButton = (
    props: Omit<CommitVariantChangesButtonProps, "appId" | "onAfterCommit" | "onCommitted">,
) => {
    const hostAdapter = useCommitHostAdapter()

    return <CommitVariantChangesButtonView {...props} {...hostAdapter} />
}

export default CommitVariantChangesButton
