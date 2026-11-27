import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SkeletonBlock} from "@agenta/ui/ui"

/** `connections`: toolbar + mark rows; `catalog`: toolbar + a two-column grid; `list`: rows. */
export type SettingsTabSkeletonKind = "list" | "connections" | "catalog"

const ROWS = Array.from({length: 6}, (_, index) => index)

const Toolbar = () => (
    <div className="mb-4 flex flex-wrap items-center gap-2">
        <SkeletonBlock active shape="soft" className="h-control w-full sm:w-72" />
        <SkeletonBlock active shape="soft" className="h-control w-20" />
    </div>
)

const MarkRow = () => (
    <div className="flex min-h-12 items-center gap-3 py-1">
        <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
        <div className="flex flex-1 flex-col gap-1.5">
            <SkeletonBlock active className="h-4 w-1/3 rounded-sm" />
            <SkeletonBlock active className="h-3 w-1/2 rounded-sm" />
        </div>
    </div>
)

/** A tab's body while its code loads, in the shape the loaded tab takes. */
export const SettingsTabSkeleton = ({kind = "list"}: {kind?: SettingsTabSkeletonKind}) => {
    const t = useT(commonCatalog)
    return (
        <div className="flex flex-col" role="status" aria-label={t("common.loading")}>
            {kind === "list" ? null : <Toolbar />}
            {kind === "catalog" ? (
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    {ROWS.map((index) => (
                        <MarkRow key={index} />
                    ))}
                </div>
            ) : kind === "connections" ? (
                <div className="flex flex-col gap-2">
                    {ROWS.map((index) => (
                        <MarkRow key={index} />
                    ))}
                </div>
            ) : (
                ROWS.map((index) => (
                    <div
                        key={index}
                        className="flex items-center gap-3 border-0 border-b border-solid border-border/40 py-3.5"
                    >
                        <SkeletonBlock active className="size-6 shrink-0 rounded-md" />
                        <div className="flex flex-1 flex-col gap-1.5">
                            <SkeletonBlock active className="h-4 w-1/3 rounded-sm" />
                            <SkeletonBlock active className="h-3.5 w-1/2 rounded-sm" />
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
