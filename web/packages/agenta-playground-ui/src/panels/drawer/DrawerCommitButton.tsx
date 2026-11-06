import {lazy, Suspense, useMemo, useState} from "react"

import {
    appEnvironmentsLoadableAtomFamily,
    environmentsListQueryAtomFamily,
} from "@agenta/entities/environment"
import {workflowDetailQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

// The shared commit dialog loads on the first click.
const CommitVariantChangesModal = lazy(() =>
    import("@agenta/playground-ui/commit").then((m) => ({default: m.CommitVariantChangesModal})),
)

/**
 * Commit for a saved revision, Create for an unsaved local one. Opens the shared commit dialog;
 * "Commit and deploy" offers the app's own environments when `canDeploy` is set.
 */
export const DrawerCommitButton = ({
    revisionId,
    canCommit,
    canDeploy,
    onCommitted,
}: {
    revisionId: string
    canCommit: boolean
    canDeploy: boolean
    onCommitted: (newRevisionId: string) => void
}) => {
    const [open, setOpen] = useState(false)
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const revision = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const dirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
    const ephemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(revisionId))
    const appId = revision?.workflow_id ?? ""
    // "Commit and deploy" names the deployment after the app's slug.
    const app = useAtomValue(workflowDetailQueryAtomFamily(canDeploy ? appId || null : null))
    const environments = useAtomValue(appEnvironmentsLoadableAtomFamily(canDeploy ? appId : ""))
    const deployOptions = useMemo(
        () =>
            canDeploy
                ? environments.data.map((environment) => ({
                      key: environment.slug || environment.name,
                      label: environment.name,
                  }))
                : [],
        [canDeploy, environments.data],
    )
    // "Commit and deploy" finds the environment in this list: keep it loaded while Commit shows.
    useAtomValue(environmentsListQueryAtomFamily(false))
    const loading = query.isPending && !ephemeral

    return (
        <>
            <Button
                size="sm"
                disabled={loading || !canCommit || !(dirty || ephemeral)}
                onClick={() => setOpen(true)}
            >
                {ephemeral ? "Create" : "Commit"}
            </Button>
            {open ? (
                <Suspense fallback={null}>
                    <CommitVariantChangesModal
                        open
                        variantId={revisionId}
                        appId={appId}
                        appSlug={app.data?.slug ?? null}
                        commitDeployOptions={deployOptions}
                        onCancel={() => setOpen(false)}
                        onSuccess={({revisionId: newRevisionId}) => {
                            if (newRevisionId) onCommitted(newRevisionId)
                        }}
                    />
                </Suspense>
            ) : null}
        </>
    )
}
