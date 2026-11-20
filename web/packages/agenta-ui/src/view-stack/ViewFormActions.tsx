import {useT} from "@agenta/i18n"
import viewStackCatalog from "@agenta/i18n/catalogs/ui.viewStack"

import {Button} from "../components/ui/button"
import {Spinner} from "../components/ui/spinner"

import type {ViewChromeProps} from "./types"

/**
 * The action row a chrome puts under the top view: Cancel and Save for an "on_save" view, Done
 * for an "immediate" one. Chromes place it (and leave it out for a view shown to read only); the
 * stack owns what each button does. `phone` makes the buttons 44 px high and as wide as the row.
 */
export const ViewFormActions = ({
    apply,
    form,
    onBack,
    onCancel,
    onSave,
    phone = false,
}: Pick<ViewChromeProps, "apply" | "form" | "onBack" | "onCancel" | "onSave"> & {
    phone?: boolean
}) => {
    const t = useT(viewStackCatalog)
    const button = phone ? "h-11 flex-1 rounded-[10px] text-[15px]" : undefined
    if (apply === "immediate") {
        return (
            <div className="flex items-center justify-end gap-2">
                <Button className={button} onClick={onBack}>
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
                <Button
                    variant="outline"
                    className={button}
                    disabled={form?.saving}
                    onClick={onCancel}
                >
                    {t("ui.viewStack.cancel")}
                </Button>
                <Button
                    className={button}
                    // Disabled until the view registers its form, and while it is clean or invalid.
                    disabled={!form || form.saving || !form.dirty || !form.valid}
                    aria-busy={form?.saving}
                    onClick={onSave}
                >
                    {form?.saving ? <Spinner size="small" /> : null}
                    {form?.saving
                        ? t("ui.viewStack.saving")
                        : (form?.saveLabel ?? t("ui.viewStack.save"))}
                </Button>
            </div>
        </div>
    )
}
