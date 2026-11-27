import {SkeletonBlock} from "@agenta/ui/ui"

import {CatalogRowSkeleton} from "../../DrillInView/SchemaControls/agentTemplate/CatalogRowSkeleton"

/** The catalog's shape while the project's connections load (STATE-02). */
export const ProviderCatalogSkeleton = () => (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 px-4 pb-2 pt-1">
            <SkeletonBlock active className="h-control w-full rounded-md" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4">
            {[2, 6].map((rows, index) => (
                <div key={index} className="flex flex-col gap-2 pt-3">
                    <SkeletonBlock active className="h-5 w-28 rounded-sm" />
                    <CatalogRowSkeleton count={rows} />
                </div>
            ))}
        </div>
    </div>
)
