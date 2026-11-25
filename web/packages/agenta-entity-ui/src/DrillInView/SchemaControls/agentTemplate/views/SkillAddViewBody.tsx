import {useCallback, useEffect, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {
    useViewForm,
    useViewTitle,
    ViewFooterStart,
    type ViewProps,
    type ViewTarget,
} from "@agenta/ui/view-stack"

import {isEmbedRefSkill, staticEmbedSlug} from "../itemDescriptors"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {skillAddNewView, type SkillAddViewParams} from "./skillAddView"

type Skill = Record<string, unknown>

const skillsOf = (agent: Skill): unknown[] => (Array.isArray(agent.skills) ? agent.skills : [])

const embedSlugOf = (entry: unknown): string | undefined =>
    isEmbedRefSkill(entry) ? staticEmbedSlug(entry as Skill) : undefined

/** Staged picks: registry skills to add (by slug) and slugs to remove. Done writes them. */
interface Picks {
    add: Map<string, Skill>
    remove: Set<string>
}

const NO_PICKS: Picks = {add: new Map(), remove: new Set()}

/** The open "Add skills" view of each revision takes the skills its "New skill" makes. */
const stagedIntake = new Map<string, (entries: Skill[]) => void>()

const intakeKey = (target: ViewTarget) => (target.kind === "agent_draft" ? target.revisionId : "")

/** The registry list of the skills bridge; Done writes the staged picks into the agent. */
const SkillAddViewBody = ({target, nav}: ViewProps<SkillAddViewParams>) => {
    const t = useT(skillsAgentCatalog)
    useViewTitle(t("skills.agent.addTitle"))
    const {skills: bridge} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const skills = skillsOf(writer.agent)
    const [picks, setPicks] = useState<Picks>(NO_PICKS)

    const onAgent = useMemo(
        () => skills.map(embedSlugOf).filter((slug): slug is string => Boolean(slug)),
        [skills],
    )
    const addedSlugs = useMemo(
        () => [...onAgent.filter((slug) => !picks.remove.has(slug)), ...picks.add.keys()],
        [onAgent, picks],
    )
    const count = skills.length - picks.remove.size + picks.add.size

    const onAdd = useCallback((entry: Skill) => {
        const slug = embedSlugOf(entry)
        if (!slug) return
        setPicks((current) => {
            const remove = new Set(current.remove)
            // Back on the agent: undo the staged remove, nothing to add.
            if (remove.delete(slug)) return {...current, remove}
            return {...current, add: new Map(current.add).set(slug, entry)}
        })
    }, [])
    // A skill made in "New skill" is staged like a pick: Done adds it, Cancel drops it.
    const key = intakeKey(target)
    useEffect(() => {
        const take = (entries: Skill[]) => entries.forEach(onAdd)
        stagedIntake.set(key, take)
        return () => {
            if (stagedIntake.get(key) === take) stagedIntake.delete(key)
        }
    }, [key, onAdd])
    const onRemove = useCallback((slug: string) => {
        setPicks((current) => {
            const add = new Map(current.add)
            if (add.delete(slug)) return {...current, add}
            return {...current, remove: new Set(current.remove).add(slug)}
        })
    }, [])

    const {update} = writer
    const save = useCallback(async () => {
        if (picks.add.size || picks.remove.size)
            update((agent) => {
                const kept = skillsOf(agent).filter((s) => {
                    const slug = embedSlugOf(s)
                    return !slug || !picks.remove.has(slug)
                })
                const present = new Set(kept.map(embedSlugOf))
                const added = [...picks.add].filter(([slug]) => !present.has(slug))
                return {...agent, skills: [...kept, ...added.map(([, entry]) => entry)]}
            })
        return true
    }, [picks, update])

    const dirty = picks.add.size > 0 || picks.remove.size > 0
    useViewForm({
        dirty,
        valid: true,
        save,
        saveLabel: t("skills.agent.done"),
        saveWhenClean: true,
        leaveDescription: t("skills.agent.leavePicks"),
    })

    const {push} = nav
    const onNewSkill = useCallback(() => void push?.(skillAddNewView, {}, target), [push, target])
    const Body = bridge?.AddSkillsBody
    if (!Body) return null
    return (
        <>
            <Body
                addedSlugs={addedSlugs}
                onAdd={onAdd}
                onRemove={onRemove}
                onNewSkill={onNewSkill}
            />
            <ViewFooterStart ownLineOnPhone>
                <span className="text-meta text-muted-foreground">
                    {t("skills.agent.onAgent", {count})}
                </span>
            </ViewFooterStart>
        </>
    )
}

/** "New skill" opened from "Add skills": each made skill joins the staged picks below it. */
export const StagedSkillNewViewBody = ({target, nav}: ViewProps<SkillAddViewParams>) => {
    const {skills: bridge} = useDrillInUI()
    const key = intakeKey(target)
    const onCreated = useCallback((entries: Skill[]) => stagedIntake.get(key)?.(entries), [key])
    const Body = bridge?.NewSkillBody
    return Body ? <Body onCreated={onCreated} onDone={nav.cancel} /> : null
}

export default SkillAddViewBody
