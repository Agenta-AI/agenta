import {SkeletonBlock} from "@agenta/ui/ui"
import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export type SkillAddViewParams = Record<string, never>

/** The shape of AddSkillsBody (skills-ui): the intro, the toolbar, then two-line rows. */
const AddSkillsSkeleton = () => (
    <div aria-hidden className="flex flex-1 flex-col gap-3 px-4 pb-3 pt-3.5">
        <SkeletonBlock active className="h-3.5 w-2/3 rounded" />
        <div className="flex items-center gap-2">
            <SkeletonBlock active className="h-control-sm flex-1 rounded-control" />
            <SkeletonBlock active className="h-control-sm w-24 shrink-0 rounded-control" />
        </div>
        <div className="-mx-3 flex flex-col gap-2">
            {Array.from({length: 5}).map((_, i) => (
                <div key={i} className="flex min-h-row-double items-center gap-3 px-3 py-1">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3 rounded" />
                        <SkeletonBlock active className="h-3 w-2/3 rounded" />
                    </div>
                </div>
            ))}
        </div>
    </div>
)

/** "Add skills": clicks stage adds and removes, Done writes them; "New skill" opens at depth 2. */
export const skillAddView = defineView<SkillAddViewParams>({
    id: "agent.skill.add",
    apply: "on_save",
    Component: lazyView(() => import("./SkillAddViewBody"), <AddSkillsSkeleton />),
})
