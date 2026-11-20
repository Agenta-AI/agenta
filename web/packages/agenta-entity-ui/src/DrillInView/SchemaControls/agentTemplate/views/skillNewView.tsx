import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export type SkillNewViewParams = Record<string, never>

/**
 * "New skill" (F07 f12 to f15): choose how, then write, upload or import, as steps of this one
 * view. "Create skill" or "Import N skills" is the save: the skill goes to the skill registry
 * and the agent gains a reference to it.
 */
export const skillNewView = defineView<SkillNewViewParams>({
    id: "agent.skill.new",
    apply: "on_save",
    wide: true,
    Component: lazyView(() => import("./SkillNewViewBody")),
})
