import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"

import {SimpleTooltip} from "../components/composed/simple-tooltip"
import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"
import {cn} from "../components/ui/utils"

import type {ViewChromeProps} from "./types"

/**
 * The action row a chrome puts under the top view: Cancel and Save for an "on_save" view, Done
 * for an "immediate" one. Chromes place it (and leave it out for a view shown to read only); the
 * stack owns what each button does. `startRef` is the slot at the left of the same row, where the
 * view's `ViewFooterStart` renders ("Remove from agent", canvas F02). `phone` lets Cancel and Save share the row,
 * Done keeps its width at the right (M09).
 */
export const ViewFormActions = ({
    apply,
    form,
    onCancel,
    onSave,
    startRef,
    phone = false,
}: Pick<ViewChromeProps, "apply" | "form" | "onBack" | "onCancel" | "onSave"> & {
    startRef?: ViewChromeProps["footerStartRef"]
    phone?: boolean
}) => {
    const t = useT(viewStackCatalog)
    // A phone puts an `ownLineOnPhone` start on its own line above the buttons.
    const start = (
        <span
            ref={startRef}
            data-footer-start=""
            className={cn(
                "mr-auto flex empty:hidden",
                phone && "has-[[data-footer-line]]:basis-full",
            )}
        />
    )
    const button = phone ? "flex-1" : undefined
    // The canvas scale on the desktop (h28, r6, 13 px); a phone uses the kit default.
    const size = phone ? undefined : "compact"
    // An instant view saves as it goes and the header's back leaves it, so the footer keeps
    // only its start (a "Remove" action) and no "Done".
    if (apply === "immediate") {
        return <div className="flex items-center gap-2">{start}</div>
    }
    // Disabled until the view registers its form, and while it is clean or invalid.
    const saveDisabled = !form || form.saving || (!form.dirty && !form.saveWhenClean) || !form.valid
    const saveButton = (
        <Button
            size={size}
            className={button}
            disabled={saveDisabled}
            aria-busy={form?.saving}
            onClick={onSave}
        >
            {form?.saving ? <Spinner size="small" /> : null}
            {form?.saving
                ? (form.savingLabel ?? t("ui.viewStack.saving"))
                : (form?.saveLabel ?? t("ui.viewStack.save"))}
        </Button>
    )
    return (
        <div className="flex flex-col gap-2">
            {form?.saveFailed ? (
                <span role="alert" className="text-meta text-destructive">
                    {t("ui.viewStack.saveFailed")}
                </span>
            ) : null}
            <div className={cn("flex items-center justify-end gap-2", phone && "flex-wrap")}>
                {start}
                <Button
                    variant="outline"
                    size={size}
                    className={button}
                    disabled={form?.saving}
                    onClick={onCancel}
                >
                    {t("ui.viewStack.cancel")}
                </Button>
                {/* A disabled button takes no pointer, so the reason's tooltip sits on a wrapper. */}
                {saveDisabled && form?.invalidReason ? (
                    <SimpleTooltip title={form.invalidReason}>
                        <span className={cn("inline-flex", button)} tabIndex={0}>
                            {saveButton}
                        </span>
                    </SimpleTooltip>
                ) : (
                    saveButton
                )}
            </div>
        </div>
    )
}
