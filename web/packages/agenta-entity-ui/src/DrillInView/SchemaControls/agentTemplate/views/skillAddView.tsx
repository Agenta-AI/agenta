import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SkillAddViewParams = Record<string, never>

/** "Add skills": a click adds or removes a registry skill at once; "New skill" opens at depth 2. */
export const skillAddView = defineView<SkillAddViewParams>({
    id: "agent.skill.add",
    apply: "immediate",
    Component: lazyView(
        () => import("./SkillAddViewBody"),
        <div className="px-4 py-3">
            <CatalogRowSkeleton />
        </div>,
    ),
})
