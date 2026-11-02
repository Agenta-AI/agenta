import {useState} from "react"

import type {AppDeploymentRow} from "@agenta/entities/environment"
import {CommitMessageInput} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {useRevertDeployment} from "./useDeploymentWrites"

/** Put the revision an older deployment used back into its environment. Mount it per row. */
export const RevertDeploymentDialog = ({
    row,
    environment,
    appId,
    appSlug,
    onClose,
}: {
    row: AppDeploymentRow
    environment: {slug: string; name: string}
    appId: string
    appSlug: string | null
    onClose: () => void
}) => {
    const revert = useRevertDeployment()
    const [note, setNote] = useState("")
    const [pending, setPending] = useState(false)

    const submit = async () => {
        if (!row.deployedRevisionId) return
        setPending(true)
        const ok = await revert({
            target: {
                revisionId: row.deployedRevisionId,
                revisionVersion: row.deployedRevisionVersion,
                appId,
                appSlug: appSlug ?? row.appSlug,
                variantId: row.variantId,
                variantSlug: row.variantSlug,
            },
            environmentSlug: environment.slug || environment.name,
            environmentName: environment.name,
            note,
        })
        setPending(false)
        if (ok) onClose()
    }

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Revert {environment.name}</DialogTitle>
                    <DialogDescription>Are you sure you want to revert?</DialogDescription>
                </DialogHeader>
                <CommitMessageInput value={note} onChange={setNote} label="Revert message" />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button disabled={pending} onClick={() => void submit()}>
                        Revert
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
