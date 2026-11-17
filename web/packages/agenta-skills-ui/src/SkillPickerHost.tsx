/**
 * The registry-backed "Add skill" flow the agent-config panel injects via the drill-in
 * `skills` bridge (artboards 4b–4g): the picker drawer over the live registry, plus the
 * same create / upload / import drawers the registry page uses. A skill created or
 * imported from here lands in the registry AND on this agent (the design's 4c contract).
 *
 * Emits fully-built `@ag.embed` entries; the PANEL owns the list write (append / filter),
 * preserving itemListOps' carry-by-reference guarantee for entries it can't parse.
 */
import {useCallback, useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {buildSkillEmbedEntry as buildEntry, type SkillEmbedTarget} from "@agenta/skills"
import {skillsListDataAtom, skillsListQueryAtom} from "@agenta/skills/state"
import type {SkillsPickerHostProps} from "@agenta/ui/drill-in"
import {useAtomValue} from "jotai"

/** The bridge speaks plain records; the entry's interface shape lacks the index signature. */
const buildSkillEmbedEntry = (target: SkillEmbedTarget): Record<string, unknown> =>
    buildEntry(target) as unknown as Record<string, unknown>

import {pickerEmbedEntry, toPickerItem} from "./pickerOptions"
import {toSourceInfo} from "./registrySections"
import {SkillCreateDrawer} from "./SkillCreateDrawer"
import {SkillPickerDrawer, type SkillAddChoice} from "./SkillPickerDrawer"
import type {SkillListItem} from "./types"
import {useSkillCreateEntry} from "./useSkillCreateEntry"

export function SkillPickerHost({open, onClose, added, onAdd, onRemove}: SkillsPickerHostProps) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const addedBySlug = useMemo(
        () => new Map(added.map((entry) => [entry.slug, {pinnedVersion: entry.pinnedVersion}])),
        [added],
    )

    const options = useMemo<SkillListItem[]>(() => {
        const project = projectSkills
            .map((item) => {
                const mapped = toPickerItem(
                    item,
                    item.origin && !item.origin.detached ? "imported" : "project",
                    addedBySlug,
                )
                if (!mapped) return null
                return item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
            })
            .filter((item): item is SkillListItem => item !== null)
        return project
    }, [addedBySlug, projectSkills])

    const handleAdd = useCallback(
        (choices: SkillAddChoice[]) => {
            onAdd(choices.map(({skill, mode}) => pickerEmbedEntry(skill, mode)))
        },
        [onAdd],
    )

    const handleRemove = useCallback(
        (skills: SkillListItem[]) => onRemove(skills.map((skill) => skill.slug)),
        [onRemove],
    )

    // New skill opens the editor straight away; a created skill also lands on this agent.
    const {createOpen, onWrite, closeCreate} = useSkillCreateEntry()

    const addCreated = useCallback(
        (created: {slug: string; workflowId?: string; name: string; description?: string}) => {
            onAdd([
                buildSkillEmbedEntry({
                    slug: created.slug,
                    workflowId: created.workflowId,
                    name: created.name,
                    description: created.description,
                    mode: "latest",
                }),
            ])
        },
        [onAdd],
    )

    return (
        <>
            <SkillPickerDrawer
                open={open}
                onClose={onClose}
                options={options}
                loading={query.isPending}
                onAdd={handleAdd}
                onRemove={handleRemove}
                onNewSkill={onWrite}
            />
            <SkillCreateDrawer
                open={createOpen}
                onClose={closeCreate}
                projectId={projectId}
                onCreated={addCreated}
            />
        </>
    )
}
