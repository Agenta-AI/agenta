/** The top of an Advanced part view and its loading shapes: the part's Mark and name over one line. */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {IconTile, ItemViewTitle, ItemViewTitleSkeleton, SkeletonBlock} from "@agenta/ui/ui"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"

/** The body's padding, as the permission list draws it: the quiet 6 px bar plus 10 px is 16 px. */
export const PART_BODY_CLASS = "ag-scroll-quiet py-4 pl-4 pr-2.5 max-md:pr-4"

/** The part's name and one line under it, as every item view's title. */
export function AdvancedPartHeader({
    icon,
    title,
    description,
}: {
    icon: ReactNode
    title: string
    description: ReactNode
}) {
    return (
        <ItemViewTitle
            className="shrink-0 px-4 pt-4"
            mark={<IconTile size={24}>{icon}</IconTile>}
            title={title}
            description={description}
        />
    )
}

/** The loading shape of a part view (STATE-02): the header over the part's own body. */
export function AdvancedPartSkeleton({body}: {body: "permissions" | "field"}) {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            className="flex min-h-0 flex-1 flex-col"
        >
            <ItemViewTitleSkeleton className="shrink-0 px-4 pt-4" />
            {body === "permissions" ? (
                <ToolPermissionsSkeleton account="none" />
            ) : (
                <div className={`flex flex-col gap-2 overflow-hidden ${PART_BODY_CLASS}`}>
                    {/* FieldHeading: the label and its 20 px info button. */}
                    <div className="flex h-5 items-center gap-1">
                        <SkeletonBlock className="h-3.5 w-14" />
                        <span className="flex size-5 items-center justify-center">
                            <SkeletonBlock shape="mark" className="size-3.5" />
                        </span>
                    </div>
                    <SkeletonBlock className="h-control rounded-control" />
                </div>
            )}
        </div>
    )
}

/** The loading shape of the Advanced list: muted cards with a 28 px Mark and a name (STATE-02). */
export function AdvancedListSkeleton() {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            className="flex flex-col gap-2 px-4 pt-3"
        >
            {["w-20", "w-24", "w-16"].map((width) => (
                <div
                    key={width}
                    className="-mx-2.5 flex h-10 items-center gap-2 rounded-lg bg-muted px-2.5"
                >
                    <SkeletonBlock shape="mark" className="size-7 shrink-0 bg-background" />
                    <SkeletonBlock className={`h-3.5 ${width}`} />
                </div>
            ))}
        </div>
    )
}
