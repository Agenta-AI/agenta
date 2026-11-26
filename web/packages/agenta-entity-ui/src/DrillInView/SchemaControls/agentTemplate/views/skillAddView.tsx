import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {SkeletonBlock} from "@agenta/ui/ui"
import {defineView, useViewTitle} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SkillAddViewParams = Record<string, never>

/** The shape of AddSkillsBody (skills-ui): the search row, a group heading, then catalog rows. */
const AddSkillsSkeleton = () => {
    const t = useT(skillsAgentCatalog)
    useViewTitle(t("skills.agent.addTitle"))
    return (
        <div aria-hidden className="flex min-h-0 flex-1 flex-col pt-3">
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                <SkeletonBlock active className="h-control flex-1 rounded-control" />
                <SkeletonBlock active className="h-control w-24 shrink-0 rounded-control" />
            </div>
            <div className="flex flex-col px-4">
                <div className="mt-3 flex h-4.5 items-center">
                    <SkeletonBlock active className="h-3.5 w-24" />
                </div>
                <div className="pt-2">
                    <CatalogRowSkeleton count={5} />
                </div>
            </div>
        </div>
    )
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
    widenButton: false,
    wide: true,
    Component: lazyView(() =>
        import("./SkillAddViewBody").then((m) => ({default: m.StagedSkillNewViewBody})),
    ),
})
