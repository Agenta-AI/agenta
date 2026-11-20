import {defineView, type ViewProps} from "@agenta/ui/view-stack"

import {NewSkillBody, type NewSkillStart} from "./NewSkillBody"

export interface RegistryNewSkillParams {
    start?: NewSkillStart
}

/** "New skill" on the Skills page (target `project`): the skill goes only to the skill registry. */
export const registryNewSkillView = defineView<RegistryNewSkillParams>({
    id: "skill.registry.new",
    apply: "on_save",
    wide: true,
    Component: ({params}: ViewProps<RegistryNewSkillParams>) => (
        <NewSkillBody start={params.start} />
    ),
})
