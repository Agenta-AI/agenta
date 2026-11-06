import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
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
    const [open, setOpen] = useState(false)
    // The server copy, not the draft, so the button does not render again while the config is
    // edited. Deploy waits for it: before it loads there is no version or variant to send.
    const data = useAtomValue(workflowMolecule.atoms.query(revisionId)).data
    // Read live, because the variants list can land after the revision.
    const variantName = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId)) ?? ""
    const row: DialogRevision | null =
        open && data
            ? {
                  revisionId,
                  version: data.version ?? 0,
                  variantId: data.workflow_variant_id ?? "",
                  variantSlug: data.workflow_variant_slug ?? null,
                  variantName,
              }
            : null

    return (
        <>
            <Button size="sm" disabled={!data} onClick={() => setOpen(true)}>
                <CloudArrowUp aria-hidden size={14} />
                Deploy
            </Button>
            {row ? (
                <DeployRevisionDialog
                    key={row.revisionId}
                    row={row}
                    appId={appId}
                    appSlug={appSlug}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}
