import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

import {summarizeNames} from "./evaluatorsView"

/** One evaluator the dialog is about. */
export interface ArchiveTarget {
    name: string | null
    version: number | null
}

const confirmText = (targets: readonly ArchiveTarget[]): string => {
    if (targets.length === 1) {
        const {name, version} = targets[0]
        return name
            ? `Are you sure you want to archive ${name}${version ? ` v${version}` : ""}?`
            : "Are you sure you want to archive this evaluator?"
    }
    const names = targets.flatMap((target) => (target.name ? [target.name] : []))
    return names.length > 0
        ? `Are you sure you want to archive the selected evaluators? ${summarizeNames(names)}`
        : "Are you sure you want to archive the selected evaluators?"
}

/**
 * Archive one or more evaluators, or say why not: when evaluation runs still use them the
 * dialog turns into a notice and nothing is archived.
 */
export const ArchiveEvaluatorsDialog = ({
    targets,
    inUseRunCount,
    pending,
    onConfirm,
    onClose,
}: {
    /** The evaluators to archive. Empty = closed. */
    targets: readonly ArchiveTarget[]
    /** Set when the check found runs that use the evaluators. */
    inUseRunCount: number | null
    pending: boolean
    onConfirm: () => void
    onClose: () => void
}) => {
    const many = targets.length > 1
    const noun = many ? "evaluators" : "evaluator"

    return (
        <AlertDialog
            open={targets.length > 0}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <AlertDialogContent
                onEscapeKeyDown={(event) => {
                    if (pending) event.preventDefault()
                }}
            >
                {inUseRunCount !== null ? (
                    <>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {many ? "Evaluators in use" : "Evaluator in use"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {`The ${noun} ${many ? "are" : "is"} currently in use by ${inUseRunCount} evaluation${inUseRunCount === 1 ? "" : "s"}. Please delete the evaluation${inUseRunCount === 1 ? "" : "s"} first.`}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogAction asChild>
                                <Button onClick={onClose}>Ok</Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </>
                ) : (
                    <>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {many ? "Archive evaluators" : "Archive evaluator"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>{confirmText(targets)}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <p className="m-0 text-sm text-muted-foreground">
                            Archived evaluators are hidden from your workspace and can be restored
                            later.
                        </p>
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={onClose} disabled={pending}>
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            {/* preventDefault keeps the dialog open: the screen closes it on
                                success, and a failure leaves it for a retry. */}
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={pending}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        onConfirm()
                                    }}
                                >
                                    {pending ? "Archiving…" : "Archive"}
                                </Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </>
                )}
            </AlertDialogContent>
        </AlertDialog>
    )
}
