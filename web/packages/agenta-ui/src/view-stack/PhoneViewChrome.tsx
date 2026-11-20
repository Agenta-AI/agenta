import {PhoneScreenHeader} from "../phone/PhoneScreenHeader"

import type {ViewChromeProps} from "./types"
import {ViewFormActions} from "./ViewFormActions"

/**
 * The top row of the phone chrome: the back arrow to the screen before (the previous crumb, read
 * "Back to Configuration") and the view's title. For a container that draws its own frame.
 */
export const PhoneViewHeader = ({crumbs, onBack}: Pick<ViewChromeProps, "crumbs" | "onBack">) => {
    const current = crumbs.at(-1)
    const previous = crumbs.length > 1 ? crumbs.at(-2) : undefined
    return (
        <PhoneScreenHeader
            title={current?.title ?? ""}
            backTitle={previous?.title || undefined}
            onBack={onBack}
        />
    )
}

/**
 * The phone chrome of a view stack: the view covers the screen, with `PhoneViewHeader` at the
 * top, the view edge to edge, and the action row at the bottom with 44 px buttons. A view shown
 * to read only gets no action row. No widen button and no Close: the back arrow is the way out.
 * A container that also has a desktop layout keeps one tree for both and builds its phone branch
 * from `PhoneViewHeader` and `ViewFormActions phone`, so a resize does not remount the view.
 */
export const PhoneViewChrome = ({
    crumbs,
    apply,
    readOnly,
    form,
    onBack,
    onCancel,
    onSave,
    children,
}: ViewChromeProps) => (
    <div data-testid="phone-view-chrome" className="flex h-full min-h-0 min-w-0 flex-col">
        <PhoneViewHeader crumbs={crumbs} onBack={onBack} />
        {/* Edge to edge: each view pads itself. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        {readOnly ? null : (
            <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary px-4 pb-6 pt-3">
                <ViewFormActions
                    phone
                    apply={apply}
                    form={form}
                    onBack={onBack}
                    onCancel={onCancel}
                    onSave={onSave}
                />
            </div>
        )}
    </div>
)
