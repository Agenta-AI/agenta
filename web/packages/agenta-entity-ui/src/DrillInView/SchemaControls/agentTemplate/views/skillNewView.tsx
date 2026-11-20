import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export type SkillNewViewParams = Record<string, never>

/** "New skill": choose how, then write, upload or import; Save adds it to the registry and the agent. */
export const skillNewView = defineView<SkillNewViewParams>({
    id: "agent.skill.new",
    apply: "on_save",
    wide: true,
    Component: lazyView(() => import("./SkillNewViewBody")),
})
