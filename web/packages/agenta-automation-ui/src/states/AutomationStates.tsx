import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button, IconTile, ItemViewTitleSkeleton, SkeletonBlock} from "@agenta/ui/ui"
import {Funnel, MagnifyingGlass} from "@phosphor-icons/react"

/**
 * Designed states for the automations screens.
 *
 * The list's loading state is not here: `@agenta/ui/list-table` draws its own skeleton in the
 * real columns, so a second copy of them cannot drift from the table.
 *
 * None of these carries a top margin: each stands where the table would, so the search bar sits
 * the same distance above whatever is showing.
 */
/** The project has automations, but the search or filters hid them; sits under the header row. */
export const AutomationListNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-14 text-center">
            <IconTile size={40}>
                {term ? <MagnifyingGlass aria-hidden /> : <Funnel aria-hidden />}
            </IconTile>
            <p className="m-0 text-body font-medium text-foreground">
                {term
                    ? t("automations.editor.noMatchTerm", {term})
                    : t("automations.editor.noMatchFilters")}
            </p>
            <p className="m-0 max-w-[42ch] text-label leading-snug text-muted-foreground">
                {term
                    ? t("automations.editor.noMatchTermBody")
                    : t("automations.editor.noMatchFiltersBody")}
            </p>
            {onClear ? (
                <Button size="sm" variant="outline" className="mt-1 text-label" onClick={onClear}>
                    {term
                        ? t("automations.editor.clearSearch")
                        : t("automations.editor.resetFilters")}
                </Button>
            ) : null}
        </div>
    )
}

/** Mirrors the detail body's own rhythm — identity, meta row, field stack — at its measurements. */
export const AutomationDetailSkeleton = () => (
    // max-md:pt-1 takes back the 4px the phone header gives up, as the loaded body does.
    <div className="mx-auto w-full max-w-content-md px-8 pb-16 max-md:pt-1" aria-hidden>
        {/* Identity: name, then the description under it. */}
        <SkeletonBlock active className="h-7 w-1/2" />
        <SkeletonBlock active className="mt-1.5 h-4 w-2/3" />
        {/* The toggle / agent / edited facts row. */}
        <div className="mb-1 mt-4 flex items-center gap-3.5">
            <SkeletonBlock active className="h-5 w-9 rounded-sm" />
            <SkeletonBlock active className="h-4 w-24" />
            <SkeletonBlock active className="h-4 w-28" />
        </div>
        {/* The three fields below them. */}
        <div className="mt-6 flex flex-col gap-6">
            {Array.from({length: 3}, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                    <SkeletonBlock active className="h-3.5 w-20" />
                    <SkeletonBlock active className="h-control w-full rounded-md" />
                    <SkeletonBlock active className="h-3 w-2/5" />
                </div>
            ))}
        </div>
    </div>
)

/** One muted Runs card: the 28px white Mark and a bar for its label (STATE-02). */
export const AutomationRunsRowSkeleton = ({width = "w-14"}: {width?: string}) => (
    <div className="-mx-2.5 flex h-10 items-center gap-2 rounded-lg bg-muted px-2.5">
        <SkeletonBlock shape="mark" className="size-7 shrink-0 bg-background" />
        <SkeletonBlock className={`h-3.5 ${width}`} />
    </div>
)

/** A field: its 18px label row, then the control at its loaded height. */
const FieldSkeleton = ({label, control}: {label: string; control: string}) => (
    <div className="flex flex-col gap-1">
        <div className="flex h-4.5 items-center">
            <SkeletonBlock className={`h-3 ${label}`} />
        </div>
        <SkeletonBlock className={`${control} rounded-control`} />
    </div>
)

/** The pane's automation view while it loads; the chrome draws its action row. */
export const AutomationPaneSkeleton = () => {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            className="flex h-full min-h-0 flex-col"
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-6 pt-4">
                <ItemViewTitleSkeleton
                    actions={
                        <>
                            <SkeletonBlock className="h-3 w-4" />
                            <SkeletonBlock shape="mark" className="h-4 w-7 rounded-round" />
                        </>
                    }
                />
                <div className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <div className="flex h-7 items-center justify-between">
                            <SkeletonBlock className="h-3.5 w-10" />
                            <SkeletonBlock className="h-7 w-24 rounded-control" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <AutomationRunsRowSkeleton width="w-16" />
                            <AutomationRunsRowSkeleton />
                            <AutomationRunsRowSkeleton />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex h-5 items-center">
                            <SkeletonBlock className="h-3.5 w-14" />
                        </div>
                        <div className="flex flex-col gap-4">
                            <FieldSkeleton label="w-16" control="h-8" />
                            <FieldSkeleton label="w-16" control="h-19.5" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
