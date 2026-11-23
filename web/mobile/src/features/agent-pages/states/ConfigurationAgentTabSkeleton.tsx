import {SkeletonBlock} from "@agenta/ui/ui"

import {CONFIGURATION_PAGE_COLUMN} from "../configurationTabs"

/** The Agent tab while its revision loads: the section nav and the sections, as it draws them. */
export const ConfigurationAgentTabSkeleton = () => (
    <div className="min-h-0 flex-1 overflow-hidden bg-muted max-md:bg-background" aria-busy>
        <div
            className={`${CONFIGURATION_PAGE_COLUMN} grid grid-cols-[168px_minmax(0,1fr)] items-start gap-10 pb-10 pt-7 max-md:block max-md:max-w-none max-md:px-4 max-md:pt-3`}
        >
            <div className="flex flex-col gap-2 max-md:hidden">
                {[0, 1, 2, 3, 4].map((row) => (
                    <SkeletonBlock key={row} active className="h-4 w-24" />
                ))}
            </div>
            <div className="flex min-w-0 flex-col gap-8">
                {[0, 1, 2].map((section) => (
                    <div key={section} className="flex flex-col gap-3">
                        <SkeletonBlock active className="h-5 w-32" />
                        <SkeletonBlock active className="h-24 w-full" />
                    </div>
                ))}
            </div>
        </div>
    </div>
)
