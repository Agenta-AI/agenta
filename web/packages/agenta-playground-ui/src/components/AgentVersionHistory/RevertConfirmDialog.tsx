import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

export interface RevertConfirmDialogProps {
    open: boolean
    /** The drawer panel: the dialog masks and centres inside it, not the page. */
    container: HTMLElement | null
    selectedVersion: number | null
    latestVersion: number | null
    onCancel: () => void
    onConfirm: () => void
}

/** The revert confirmation, scoped to the version history drawer. */
export const RevertConfirmDialog = ({
    open,
    container,
    selectedVersion,
    latestVersion,
    onCancel,
    onConfirm,
}: RevertConfirmDialogProps) => (
    // Non-modal: the drawer already traps focus; a second modal layer would fight it.
    <Dialog modal={false} open={open} onOpenChange={(next) => !next && onCancel()}>
        <DialogContent
            container={container}
            contained
            showCloseButton={false}
            className="max-w-[400px]"
        >
            <DialogHeader>
                <DialogTitle>Revert to v{selectedVersion}?</DialogTitle>
                <DialogDescription>
                    This commits v{(latestVersion ?? 0) + 1} with v{selectedVersion}&apos;s
                    configuration. Versions v1–v{latestVersion} stay exactly as they are.
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button onClick={onConfirm}>Revert</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
)
