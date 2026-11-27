import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {defineView, useViewTitle} from "@agenta/ui/view-stack"

import {CatalogListSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SkillAddViewParams = Record<string, never>

/** The shape of AddSkillsBody (skills-ui): the search row with New skill, Added, All skills. */
const AddSkillsSkeleton = () => {
    const t = useT(skillsAgentCatalog)
    useViewTitle(t("skills.agent.addTitle"))
    return <CatalogListSkeleton action="w-24" groups={[3, 3]} />
}

/** "Add skills": each "+" adds the skill to the agent at once; "New skill" opens at depth 2. */
export const skillAddView = defineView<SkillAddViewParams>({
    id: "agent.skill.add",
    apply: "immediate",
    Component: lazyView(() => import("./SkillAddViewBody"), <AddSkillsSkeleton />),
})

/** "New skill" from "Add skills": the made skills are added to the agent. */
export const skillAddNewView = defineView<SkillAddViewParams>({
    id: "agent.skill.add.new",
    apply: "on_save",
    wide: true,
    Component: lazyView(() =>
        import("./SkillAddViewBody").then((m) => ({default: m.StagedSkillNewViewBody})),
    ),
})
