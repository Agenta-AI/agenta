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

/** Asks before unsaved skill work is thrown away. */
export function SkillDiscardDialog({
    open,
    title,
    description,
    onCancel,
    onDiscard,
}: {
    open: boolean
    title: string
    description: string
    onCancel: () => void
    onDiscard: () => void
}) {
    return (
        <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <AlertDialogContent className="sm:max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline">Keep editing</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button variant="destructive" onClick={onDiscard}>
                            Discard
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
