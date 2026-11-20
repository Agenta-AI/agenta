import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {defineView} from "@agenta/ui/view-stack"

import {SkillFormSkeleton} from "../../DrawerSkeletons"
import {isEmbedRefSkill, staticEmbedSlug} from "../itemDescriptors"

import {lazyView} from "./lazyView"

export interface SkillViewParams {
    /**
     * The skill, by its key in the agent's skills: the name of an agent-only skill, or the
     * workflow slug of a registry skill's embed reference.
     */
    item: ConfigItemRef
}

/**
 * One skill of the agent (F07 f1 to f10). An agent-only skill saves into the agent configuration,
 * and auto-save saves the version. A registry skill saves a new revision in the skill registry;
 * the Skills page mounts the same registry body.
 */
export const skillView = defineView<SkillViewParams>({
    id: "agent.skill",
    apply: "on_save",
    // Read only on a phone (phone-layout "Read-only views on a phone").
    readOnlyOnPhone: true,
    wide: true,
    Component: lazyView(
        () => import("./SkillViewBody"),
        <div className="p-4">
            <SkillFormSkeleton />
        </div>,
    ),
})

type Skill = Record<string, unknown>

const asSkill = (entry: unknown): Skill | null =>
    entry && typeof entry === "object" ? (entry as Skill) : null

/** An agent-only skill whose name is `key`. */
export const isAgentOnlySkillWithKey = (entry: unknown, key: string): boolean => {
    const skill = asSkill(entry)
    return Boolean(skill && !isEmbedRefSkill(skill) && skill.name === key)
}

/** The address of a skill of the agent: the name of an agent-only skill, the embed slug of a registry skill. */
export const skillItemRef = (entry: unknown): ConfigItemRef | null => {
    const skill = asSkill(entry)
    if (!skill) return null
    const key = isEmbedRefSkill(skill) ? staticEmbedSlug(skill) : skill.name
    return typeof key === "string" && key ? {list: "skills", key} : null
}

/**
 * The skill with this key. After "Publish to skill registry" the agent-only skill is a registry
 * reference that keeps the skill's name beside it, so the open view still finds the same skill.
 */
export const findSkillByKey = (skills: unknown[], key: string): Skill | undefined => {
    const exact = skills.find((entry) => skillItemRef(entry)?.key === key)
    if (exact) return asSkill(exact) ?? undefined
    const published = skills.find((entry) => {
        const skill = asSkill(entry)
        return Boolean(skill && isEmbedRefSkill(skill) && skill.name === key)
    })
    return asSkill(published) ?? undefined
}
