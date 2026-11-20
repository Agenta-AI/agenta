import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"

import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"

import type {ViewChromeProps} from "./types"

/**
 * The action row a chrome puts under the top view: Cancel and Save for an "on_save" view, Done
 * for an "immediate" one. Chromes place it (and leave it out for a view shown to read only); the
 * stack owns what each button does. `startRef` is the slot at the left of the same row, where the
 * view's `ViewFooterStart` renders ("Remove from agent", canvas F02). `phone` makes the buttons 44 px high; Cancel and Save share the row,
 * Done keeps its width at the right (M09).
 */
export const ViewFormActions = ({
    apply,
    form,
    onBack,
    onCancel,
    onSave,
    startRef,
    phone = false,
}: Pick<ViewChromeProps, "apply" | "form" | "onBack" | "onCancel" | "onSave"> & {
    startRef?: ViewChromeProps["footerStartRef"]
    phone?: boolean
}) => {
    const t = useT(viewStackCatalog)
    const start = <span ref={startRef} className="mr-auto flex empty:hidden" />
    const button = phone ? "h-11 flex-1 rounded-[10px] text-[15px]" : undefined
    // The canvas scale on the desktop (h28, r6, 13 px); a phone keeps 44 px buttons.
    const size = phone ? undefined : "compact"
    if (apply === "immediate") {
        return (
            <div className="flex items-center justify-end gap-2">
                {start}
                <Button
                    size={size}
                    className={phone ? "h-11 w-24 rounded-[10px] text-[15px]" : undefined}
                    onClick={onBack}
                >
                    {t("ui.viewStack.done")}
                </Button>
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-2">
            {form?.saveFailed ? (
                <span role="alert" className="text-xs text-colorError">
                    {t("ui.viewStack.saveFailed")}
                </span>
            ) : null}
            <div className="flex items-center justify-end gap-2">
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
                <Button
                    size={size}
                    className={button}
                    // Disabled until the view registers its form, and while it is clean or invalid.
                    disabled={!form || form.saving || !form.dirty || !form.valid}
                    aria-busy={form?.saving}
                    onClick={onSave}
                >
                    {form?.saving ? <Spinner size="small" /> : null}
                    {form?.saving
                        ? (form.savingLabel ?? t("ui.viewStack.saving"))
                        : (form?.saveLabel ?? t("ui.viewStack.save"))}
                </Button>
            </div>
        </div>
    )
}
