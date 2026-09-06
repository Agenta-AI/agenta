/**
 * The registry-backed "Add skill" flow the agent-config panel injects via the drill-in
 * `skills` bridge (artboards 4b–4g): the picker drawer over the live registry, plus the
 * same create / upload / import drawers the registry page uses. A skill created or
 * imported from here lands in the registry AND on this agent (the design's 4c contract).
 *
 * Emits fully-built `@ag.embed` entries; the PANEL owns the list write (append / filter),
 * preserving itemListOps' carry-by-reference guarantee for entries it can't parse.
 */
import {useCallback, useMemo, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {
    buildSkillEmbedEntry as buildEntry,
    type SkillEmbedTarget,
    type SkillRegistryItem,
} from "@agenta/skills"
import {
    builtinSkillsAtom,
    registrySourcesAtom,
    skillsListDataAtom,
    skillsListQueryAtom,
} from "@agenta/skills/state"
import type {SkillsPickerHostProps} from "@agenta/ui/drill-in"
import {useAtomValue} from "jotai"

/** The bridge speaks plain records; the entry's interface shape lacks the index signature. */
const buildSkillEmbedEntry = (target: SkillEmbedTarget): Record<string, unknown> =>
    buildEntry(target) as unknown as Record<string, unknown>

import {toSourceInfo} from "./registrySections"
import {SkillCreateDrawer} from "./SkillCreateDrawer"
import {SkillImportDrawer} from "./SkillImportDrawer"
import {SkillPickerDrawer, type SkillAddChoice} from "./SkillPickerDrawer"
import type {SkillListItem} from "./types"

/** Embed identity is the WORKFLOW slug (builtins: `__ag__…`); display is the skill name. */
const toPickerItem = (
    item: SkillRegistryItem,
    origin: SkillListItem["origin"],
    added: Map<string, {pinnedVersion?: string}>,
): SkillListItem | null => {
    const slug = item.workflow_slug ?? undefined
    if (!slug) return null
    const addedEntry = added.get(slug)
    return {
        id: item.workflow_id ?? item.id ?? slug,
        slug,
        name: item.name ?? item.skill_name ?? slug,
        description: item.description ?? item.skill_description ?? undefined,
        origin,
        version: item.version?.replace(/^v/, "") ?? undefined,
        added: Boolean(addedEntry),
        pinnedVersion: addedEntry?.pinnedVersion,
    }
}

export function SkillPickerHost({open, onClose, added, onAdd, onRemove}: SkillsPickerHostProps) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const builtinSkills = useAtomValue(builtinSkillsAtom)
    const registrySources = useAtomValue(registrySourcesAtom)

    const addedBySlug = useMemo(
        () => new Map(added.map((entry) => [entry.slug, {pinnedVersion: entry.pinnedVersion}])),
        [added],
    )

    const sourceById = useMemo(
        () => new Map(registrySources.filter((s) => s.id).map((s) => [s.id!, s])),
        [registrySources],
    )

    const options = useMemo<SkillListItem[]>(() => {
        const project = projectSkills
            .map((item) => {
                const mapped = toPickerItem(
                    item,
                    item.source_id && !item.source_detached ? "imported" : "project",
                    addedBySlug,
                )
                if (!mapped) return null
                const source = item.source_id ? sourceById.get(item.source_id) : undefined
                return source
                    ? {...mapped, source: toSourceInfo(source, item.source_detached)}
                    : mapped
            })
            .filter((item): item is SkillListItem => item !== null)
        const builtin = builtinSkills
            .map((item) => toPickerItem(item, "builtin", addedBySlug))
            .filter((item): item is SkillListItem => item !== null)
        return [...project, ...builtin]
    }, [addedBySlug, builtinSkills, projectSkills, sourceById])

    const handleAdd = useCallback(
        (choices: SkillAddChoice[]) => {
            onAdd(
                choices.map(({skill, mode}) =>
                    buildSkillEmbedEntry({
                        slug: skill.slug,
                        workflowId: skill.id || undefined,
                        name: skill.name,
                        description: skill.description,
                        mode,
                        version: skill.version,
                    }),
                ),
            )
        },
        [onAdd],
    )

    const handleRemove = useCallback(
        (skills: SkillListItem[]) => onRemove(skills.map((skill) => skill.slug)),
        [onRemove],
    )

    // The `+ New skill ▾` paths: created/imported skills also land on this agent.
    const [createMode, setCreateMode] = useState<"write" | "upload" | null>(null)
    const [importOpen, setImportOpen] = useState(false)
    const createActions = useMemo(
        () => ({
            onWrite: () => setCreateMode("write"),
            onUpload: () => setCreateMode("upload"),
            onImport: () => setImportOpen(true),
        }),
        [],
    )

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

    const addImported = useCallback(
        (imported: {name?: string; workflowId?: string; pathInRepo: string}[]) => {
            onAdd(
                imported
                    .filter((entry) => entry.name)
                    .map((entry) =>
                        buildSkillEmbedEntry({
                            slug: entry.name!,
                            workflowId: entry.workflowId,
                            name: entry.name!,
                            mode: "latest",
                        }),
                    ),
            )
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
                createActions={createActions}
            />
            <SkillCreateDrawer
                open={createMode !== null}
                onClose={() => setCreateMode(null)}
                projectId={projectId}
                mode={createMode ?? "write"}
                onCreated={addCreated}
            />
            <SkillImportDrawer
                open={importOpen}
                onClose={() => setImportOpen(false)}
                projectId={projectId}
                onImported={addImported}
            />
        </>
    )
}
