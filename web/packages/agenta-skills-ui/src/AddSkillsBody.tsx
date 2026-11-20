/**
 * The body of the agent's "Add skills" view (F04 f2), handed over by the skills bridge. Each row
 * is one toggle: a click adds the skill and follows its latest version, a click on an added row
 * removes it. The agent's own view writes each click into the agent configuration.
 */
import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import skillNewCatalog from "@agenta/i18n/catalogs/entityUi.skillNew"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {skillsListDataAtom, skillsListQueryAtom} from "@agenta/skills/state"
import {SkillMark} from "@agenta/ui/agent-icon"
import type {SkillsAddBodyProps} from "@agenta/ui/drill-in"
import {Button, EmptyState, SearchInput, SkeletonBlock} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {filterSkillOptions, pickerEmbedEntry, toPickerItem} from "./pickerOptions"
import {toSourceInfo} from "./registrySections"
import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

const ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-3 rounded-[10px] border-0 bg-transparent px-2 py-2 text-left font-[inherit] outline-none transition-colors hover:bg-accent focus-visible:bg-accent"

function SkillRow({option, onToggle}: {option: SkillListItem; onToggle: () => void}) {
    const t = useT(skillsGalleryCatalog, skillNewCatalog)
    const title = skillTitle(option)
    const description = option.description?.trim() || t("skills.gallery.noDescription")
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={Boolean(option.added)}
            aria-label={t(
                option.added
                    ? "entityUi.skillNew.removeSkillAria"
                    : "entityUi.skillNew.addSkillAria",
                {name: title},
            )}
            className={ROW}
        >
            <SkillMark size={32} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-sm font-medium leading-[1.45] text-foreground">
                    {title}
                </span>
                <span className="truncate text-xs leading-[1.45] text-muted-foreground">
                    {option.source ? `${description} · ${option.source.label}` : description}
                </span>
            </span>
            {option.added ? (
                <span className="flex shrink-0 items-center gap-1 pl-2 text-xs text-muted-foreground">
                    <Check aria-hidden size={14} />
                    {t("entityUi.skillNew.added")}
                </span>
            ) : (
                <Plus aria-hidden size={14} className="ml-2 shrink-0 text-muted-foreground" />
            )}
        </button>
    )
}

function RowsSkeleton() {
    return (
        <div aria-hidden className="flex flex-col">
            {Array.from({length: 5}).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-lg" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3 rounded" />
                        <SkeletonBlock active className="h-3 w-2/3 rounded" />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function AddSkillsBody({addedSlugs, onAdd, onRemove, onNewSkill}: SkillsAddBodyProps) {
    const t = useT(skillsGalleryCatalog)
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const [search, setSearch] = useState("")

    const options = useMemo<SkillListItem[]>(() => {
        const added = new Map(addedSlugs.map((slug) => [slug, {}]))
        return projectSkills
            .map((item) => {
                const mapped = toPickerItem(
                    item,
                    item.origin && !item.origin.detached ? "imported" : "project",
                    added,
                )
                if (!mapped) return null
                return item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
            })
            .filter((item): item is SkillListItem => item !== null)
    }, [addedSlugs, projectSkills])
    const visible = useMemo(() => filterSkillOptions(options, search), [options, search])
    const searching = Boolean(search.trim())

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            <div className="flex items-center gap-2">
                <SearchInput
                    placeholder={t("skills.gallery.searchPlaceholder")}
                    aria-label={t("skills.gallery.searchAria")}
                    value={search}
                    onValueChange={setSearch}
                />
                <Button variant="outline" onClick={onNewSkill} className="shrink-0 gap-1.5">
                    <Plus size={14} />
                    {t("skills.gallery.newSkill")}
                </Button>
            </div>
            {query.isPending ? (
                <RowsSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState
                    image="simple"
                    description={
                        <span className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-colorText">
                                {searching
                                    ? t("skills.gallery.noMatchTitle")
                                    : t("skills.gallery.noSkillsTitle")}
                            </span>
                            <span>
                                {searching
                                    ? t("skills.gallery.noMatchName")
                                    : t("skills.gallery.createBelow")}
                            </span>
                        </span>
                    }
                />
            ) : (
                <div className="-mx-2 flex flex-col gap-0.5">
                    {visible.map((option) => (
                        <SkillRow
                            key={option.id}
                            option={option}
                            onToggle={() =>
                                option.added
                                    ? onRemove(option.slug)
                                    : onAdd(pickerEmbedEntry(option, "latest"))
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default AddSkillsBody
