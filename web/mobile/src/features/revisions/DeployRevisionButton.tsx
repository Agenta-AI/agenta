import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useStore} from "jotai"
import dynamic from "next/dynamic"

import type {DialogRevision} from "../variants/DeployRevisionDialog"

// The dialog loads when it first opens.
const DeployRevisionDialog = dynamic(
    () => import("../variants/DeployRevisionDialog").then((m) => m.DeployRevisionDialog),
    {ssr: false},
)

/** Deploy for the revision a drawer shows: picks environments for it, as the registry row does. */
export const DeployRevisionButton = ({
    revisionId,
    appId,
    appSlug,
}: {
    revisionId: string
    appId: string
    appSlug: string | null
}) => {
    const store = useStore()
    const [row, setRow] = useState<DialogRevision | null>(null)

    // Read at click time, so the button does not render again while the config is edited.
    const open = () => {
        const data = store.get(workflowMolecule.selectors.data(revisionId))
        setRow({
            revisionId,
            version: data?.version ?? 0,
            variantId: data?.workflow_variant_id ?? "",
            variantSlug: data?.workflow_variant_slug ?? null,
            variantName: store.get(workflowMolecule.selectors.variantLabel(revisionId)) ?? "",
        })
    }

    return (
        <>
            <Button size="sm" onClick={open}>
                <CloudArrowUp aria-hidden size={14} />
                Deploy
            </Button>
            {row ? (
                <DeployRevisionDialog
                    key={row.revisionId}
                    row={row}
                    appId={appId}
                    appSlug={appSlug}
                    onClose={() => setRow(null)}
                />
            ) : null}
        </>
    )
}
