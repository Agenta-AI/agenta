import {cn} from "../../foundation/utils/cn"
import {PhoneScreenHeader} from "../phone/PhoneScreenHeader"

import type {ViewChromeProps} from "./types"
import {ViewFormActions} from "./ViewFormActions"

/**
 * The top row of the phone chrome: the back arrow to the screen before (the previous crumb, read
 * "Back to Configuration") and the view's title. For a container that draws its own frame.
 */
export const PhoneViewHeader = ({
    crumbs,
    onBack,
    form,
}: Pick<ViewChromeProps, "crumbs" | "onBack"> & {form?: ViewChromeProps["form"]}) => {
    const current = crumbs.at(-1)
    const previous = crumbs.length > 1 ? crumbs.at(-2) : undefined
    // A step inside the view goes back to its own step before, not to the previous view.
    const backTitle = form?.back ? form.backTitle : previous?.title
    return (
        <PhoneScreenHeader
            title={current?.title ?? ""}
            backTitle={backTitle || undefined}
            onBack={onBack}
        />
    )
}

/**
 * The phone chrome of a view stack: the view covers the screen, with `PhoneViewHeader` at the
 * top, the view edge to edge, and the action row at the bottom, clear of the home indicator. A view shown
 * to read only gets no action row. No widen button and no Close: the back arrow is the way out.
 * A container that also has a desktop layout keeps one tree for both and builds its phone branch
 * from `PhoneViewHeader` and `ViewFormActions phone`, so a resize does not remount the view.
 */
export const PhoneViewChrome = ({
    crumbs,
    apply,
    hideActionRow,
    form,
    footerStartRef,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => (
    <div data-testid="phone-view-chrome" className="flex h-full min-h-0 min-w-0 flex-col">
        <PhoneViewHeader crumbs={crumbs} onBack={onBack} form={form} />
        {/* Edge to edge: each view pads itself. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        {hideActionRow ? null : (
            <div
                className={cn(
                    "shrink-0 border-0 border-t border-solid border-border-muted px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3",
                    // An instant view with nothing in its start shows no footer at all.
                    apply === "immediate" && "[&:has([data-footer-start]:empty)]:hidden",
                )}
            >
                <ViewFormActions
                    phone
                    apply={apply}
                    form={form}
                    onBack={onBack}
                    onCancel={onCancel}
                    onSave={onSave}
                    startRef={footerStartRef}
                />
            </div>
        )}
    </div>
)
