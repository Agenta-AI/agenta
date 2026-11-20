import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SkillAddViewParams = Record<string, never>

/**
 * "Add skills" (F04 f2): a picker over the skill registry. A click on a row adds the skill to the
 * agent at once and follows its latest version; a click on an added row removes it. "New skill"
 * opens the new skill view at depth 2. Done goes back.
 */
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
