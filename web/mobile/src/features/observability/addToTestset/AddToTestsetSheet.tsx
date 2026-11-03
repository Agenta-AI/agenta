import {useState} from "react"

import {LoadError} from "@agenta/ui/components/presentational"
import {
    Alert,
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Badge,
    Button,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Textarea,
} from "@agenta/ui/ui"

import {MappingPreview} from "./MappingPreview"
import {MappingRows} from "./MappingRows"
import {AddToTestsetSkeleton} from "./states/AddToTestsetSkeleton"
import {TestsetTargetField} from "./TestsetTargetField"
import {useAddToTestsetForm} from "./useAddToTestsetForm"

/**
 * Adds the selected spans to a test set: pick the target, map span data to columns, check the
 * preview, save. It is mounted only while open, so closing it drops every choice and writes
 * nothing.
 */
export const AddToTestsetSheet = ({
    spanIds,
    onClose,
}: {
    spanIds: readonly string[]
    onClose: () => void
}) => {
    const form = useAddToTestsetForm({spanIds, onSaved: onClose})
    const [confirming, setConfirming] = useState(false)
    const isNew = form.target?.kind === "new"
    const testsetName = form.target?.kind === "existing" ? form.target.name : ""

    const save = () => {
        setConfirming(false)
        void form.submit()
    }

    const body = () => {
        if (form.status === "loading") return <AddToTestsetSkeleton />
        if (form.status === "error") {
            return <LoadError title="Couldn't load the selected spans" onRetry={form.retrySpans} />
        }
        return (
            <>
                {form.spanCount > 1 ? (
                    <p className="text-muted-foreground m-0 text-sm">
                        {form.spanCount} spans selected
                    </p>
                ) : null}
                {form.differentStructure ? (
                    <Alert
                        type="warning"
                        showIcon
                        message="Some of the selected spans have a different structure than the others."
                    />
                ) : null}
                <TestsetTargetField
                    target={form.target}
                    onTargetChange={form.setTarget}
                    newName={form.newName}
                    onNewNameChange={form.setNewName}
                />
                <MappingRows
                    hasTarget={Boolean(form.target)}
                    isNewTestset={isNew}
                    columnsStatus={form.columns.status}
                    columns={form.columns.keys}
                    onRetryColumns={form.columns.retry}
                    pathOptions={form.pathOptions}
                    mappings={form.mappings}
                    duplicates={form.duplicates}
                    onEdit={form.editMapping}
                    onAdd={form.addMapping}
                    onRemove={form.removeMapping}
                />
                <MappingPreview
                    spanCount={form.spanCount}
                    columns={form.previewColumns}
                    rows={form.previewRows}
                />
                <label className="flex flex-col gap-1 text-sm">
                    Commit message (optional)
                    <Textarea
                        placeholder="Describe your changes..."
                        maxLength={500}
                        value={form.message}
                        onChange={(event) => form.setMessage(event.target.value)}
                    />
                </label>
            </>
        )
    }

    return (
        <Sheet open onOpenChange={(open) => !open && !form.saving && onClose()}>
            <SheetContent
                side="right"
                className="w-full max-sm:inset-0 max-sm:rounded-none sm:w-[640px] sm:max-w-[calc(100vw-1rem)]"
            >
                <SheetHeader>
                    <SheetTitle>Add to test set</SheetTitle>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
                    {body()}
                </div>
                <SheetFooter className="flex-row justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={form.saving}>
                        Cancel
                    </Button>
                    <LoadingButton
                        loading={form.saving}
                        disabled={!form.canSubmit}
                        onClick={() => (form.needsConfirm ? setConfirming(true) : save())}
                    >
                        {isNew ? "Create" : "Commit"}
                    </LoadingButton>
                </SheetFooter>
            </SheetContent>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Add new columns to test set</AlertDialogTitle>
                        <AlertDialogDescription>
                            You are about to add new columns to the {testsetName} test set. This
                            will create a new revision.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        New columns:
                        {form.newColumns.map((column) => (
                            <Badge key={column}>
                                {column}
                            </Badge>
                        ))}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <Button onClick={save}>Confirm</Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    )
}

export default AddToTestsetSheet
