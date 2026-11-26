/** The top of an Advanced part view and its loading shapes: the part's Mark and name over one line. */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {IconTile, SkeletonBlock} from "@agenta/ui/ui"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"

/** The body's padding, as the permission list draws it: the quiet 6 px bar plus 10 px is 16 px. */
export const PART_BODY_CLASS = "ag-scroll-quiet py-4 pl-4 pr-2.5 max-md:pr-4"

/** The pane header shows only Back, so the view names its part, as the integration view does. */
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
        <div className="flex shrink-0 flex-col gap-1.5 px-4 pt-4">
            {/* A 24 px Mark, 8 px to the name, as every item view's title (CONS-01, SPACE-04). */}
            <div className="flex min-w-0 items-center gap-2">
                <IconTile size={24} aria-hidden>
                    {icon}
                </IconTile>
                <span className="truncate text-label font-semibold leading-5">{title}</span>
            </div>
            <span className="text-meta text-muted-foreground">{description}</span>
        </div>
    )
}

const HeaderSkeleton = () => (
    <div className="flex shrink-0 flex-col gap-1.5 px-4 pt-4">
        <div className="flex items-center gap-2">
            <SkeletonBlock shape="mark" className="size-6 shrink-0" />
            <div className="flex h-5 min-w-0 flex-1 items-center">
                <SkeletonBlock className="h-3.5 w-24" />
            </div>
        </div>
        <div className="flex h-4 items-center">
            <SkeletonBlock className="h-3 w-3/5" />
        </div>
    </div>
)

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
            <HeaderSkeleton />
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
