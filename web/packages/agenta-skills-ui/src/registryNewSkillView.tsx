import {lazy, Suspense} from "react"

import {defineView, type ViewProps} from "@agenta/ui/view-stack"

import type {NewSkillStart} from "./NewSkillBody"

const Body = lazy(() => import("./NewSkillBody"))

export interface RegistryNewSkillParams {
    start?: NewSkillStart
}

/** "New skill" on the Skills page (target `project`): the skill goes only to the skill registry. */
export const registryNewSkillView = defineView<RegistryNewSkillParams>({
    id: "skill.registry.new",
    apply: "on_save",
    wide: true,
    Component: ({params}: ViewProps<RegistryNewSkillParams>) => (
        <Suspense fallback={null}>
            <Body start={params.start} />
        </Suspense>
    ),
})
