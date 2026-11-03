import {useMemo} from "react"

import {appEnvironmentsLoadableAtomFamily} from "@agenta/entities/environment"
import {CommitVariantChangesModal} from "@agenta/playground-ui/commit"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/**
 * The shared commit dialog for one revision. "Commit and deploy" offers this project's own
 * environments, not a fixed list. A commit makes a new revision, which `onCommitted` shows.
 * Mount it only while it is open.
 */
export const CommitRevisionModal = ({
    revisionId,
    appId,
    appSlug,
    onClose,
    onCommitted,
}: {
    revisionId: string
    appId: string
    appSlug: string | null
    onClose: () => void
    onCommitted: (revisionId: string) => void
}) => {
    const queryClient = useQueryClient()
    const environments = useAtomValue(appEnvironmentsLoadableAtomFamily(appId))
    const deployOptions = useMemo(
        () =>
            environments.data.map((environment) => ({
                key: environment.slug || environment.name,
                label: environment.name,
            })),
        [environments.data],
    )

    return (
        <CommitVariantChangesModal
            open
            variantId={revisionId}
            appId={appId}
            appSlug={appSlug}
            commitDeployOptions={deployOptions}
            onCancel={onClose}
            onAfterCommit={() =>
                void queryClient.invalidateQueries({queryKey: ["workflows", "app-revisions"]})
            }
            onSuccess={({revisionId: newRevisionId}) => {
                if (newRevisionId) onCommitted(newRevisionId)
            }}
        />
    )
}
