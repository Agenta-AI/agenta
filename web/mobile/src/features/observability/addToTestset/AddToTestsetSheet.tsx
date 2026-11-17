import {useState} from "react"

import {useT} from "@agenta/i18n"
import addToTestsetCatalog from "@agenta/i18n/catalogs/observability.addToTestset"
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
    const t = useT(addToTestsetCatalog)
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
            return (
                <LoadError
                    title={t("observability.addToTestset.selectedSpansLoadFailed")}
                    onRetry={form.retrySpans}
                />
            )
        }
        return (
            <>
                {form.spanCount > 1 ? (
                    <p className="text-muted-foreground m-0 text-sm">
                        {t("observability.addToTestset.spansSelected", {count: form.spanCount})}
                    </p>
                ) : null}
                {form.differentStructure ? (
                    <Alert
                        type="warning"
                        showIcon
                        message={t("observability.addToTestset.differentStructure")}
                    />
                ) : null}
                <TestsetTargetField
                    target={form.target}
                    onTargetChange={form.setTarget}
                    revisions={form.revisions}
                    newName={form.newName}
                    onNewNameChange={form.setNewName}
                />
                {/* As in the old app, mapping and preview follow once a test set is chosen. */}
                {form.target ? (
                    <>
                        <MappingRows
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
                    </>
                ) : null}
                <label className="flex flex-col gap-1 text-sm">
                    {t("observability.addToTestset.commitMessage")}
                    <Textarea
                        placeholder={t("observability.addToTestset.commitMessagePlaceholder")}
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
                    <SheetTitle>{t("observability.addToTestset.sheetTitle")}</SheetTitle>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
                    {body()}
                </div>
                <SheetFooter className="flex-row justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={form.saving}>
                        {t("observability.addToTestset.cancel")}
                    </Button>
                    <LoadingButton
                        loading={form.saving}
                        disabled={!form.canSubmit}
                        onClick={() => (form.needsConfirm ? setConfirming(true) : save())}
                    >
                        {isNew
                            ? t("observability.addToTestset.create")
                            : t("observability.addToTestset.commit")}
                    </LoadingButton>
                </SheetFooter>
            </SheetContent>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("observability.addToTestset.confirmTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("observability.addToTestset.confirmDescription", {
                                name: testsetName,
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        {t("observability.addToTestset.newColumns")}
                        {form.newColumns.map((column) => (
                            <Badge key={column}>{column}</Badge>
                        ))}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline">
                                {t("observability.addToTestset.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <Button onClick={save}>{t("observability.addToTestset.confirm")}</Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    )
}

export default AddToTestsetSheet
