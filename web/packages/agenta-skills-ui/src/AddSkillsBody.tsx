/** The registry list of the agent's "Add skills" view: each row toggles one reference. */
import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {skillsResolveDataAtom, skillsResolveQueryAtom} from "@agenta/skills/state"
import {SkillMark} from "@agenta/ui/agent-icon"
import type {AddSkillsBodyProps} from "@agenta/ui/drill-in"
import {Button, EmptyState, SearchInput, SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {filterSkillOptions, pickerEmbedEntry, toPickerItem} from "./pickerOptions"
import {toSourceInfo} from "./registrySections"
import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

/** A two-line row (48px); its hover fill hangs 12px past the column so the Mark stays on the line. */
const ROW =
    "box-border flex min-h-row-double w-full cursor-pointer items-center gap-3 rounded-md px-3 py-1 transition-colors duration-[var(--duration-fast)] ease-out hover:bg-accent motion-reduce:transition-none"

function SkillRow({option, onToggle}: {option: SkillListItem; onToggle: () => void}) {
    const t = useT(skillsGalleryCatalog, skillsAgentCatalog)
    const title = skillTitle(option)
    const description = option.description?.trim() || t("skills.gallery.noDescription")
    const label = t(option.added ? "skills.agent.removeFromAgent" : "skills.agent.addToAgent")
    return (
        // The row is a large mouse target; the button is the control for the keyboard and readers.
        <div className={ROW} onClick={onToggle}>
            <SkillMark size={32} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-label font-medium leading-5 text-foreground">
                    {title}
                </span>
                <span className="truncate text-meta text-muted-foreground">
                    {option.source ? `${option.source.label} · ${description}` : description}
                </span>
            </span>
            <SimpleTooltip title={label}>
                <Button
                    variant={option.added ? "secondary" : "outline"}
                    size="icon-sm"
                    aria-label={`${label}: ${title}`}
                    className="shrink-0"
                    onClick={(event) => {
                        event.stopPropagation()
                        onToggle()
                    }}
                >
                    {option.added ? <Check size={14} /> : <Plus size={14} />}
                </Button>
            </SimpleTooltip>
        </div>
    )
}

/** Loading rows in the shape of SkillRow. */
function RowsSkeleton() {
    return (
        <div aria-hidden className="-mx-3 flex flex-col gap-2">
            {Array.from({length: 5}).map((_, i) => (
                <div key={i} className="flex min-h-row-double items-center gap-3 px-3 py-1">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3 rounded" />
                        <SkeletonBlock active className="h-3 w-2/3 rounded" />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function AddSkillsBody({addedSlugs, onAdd, onRemove, onNewSkill}: AddSkillsBodyProps) {
    const t = useT(skillsGalleryCatalog, skillsAgentCatalog)
    // The unfiltered registry: the Skills page search must not narrow this list.
    const query = useAtomValue(skillsResolveQueryAtom)
    const registry = useAtomValue(skillsResolveDataAtom)
    const [search, setSearch] = useState("")
    // The order is fixed when the list opens, so a row does not move away from a click.
    const [first] = useState(() => new Set(addedSlugs))

    const options = useMemo<SkillListItem[]>(() => {
        const added = new Map(addedSlugs.map((slug) => [slug, {}]))
        return (
            registry
                .filter((item) => !item.archived)
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
                // The agent's skills first (F04 f2); the sort keeps the registry order within each part.
                .sort((a, b) => Number(first.has(b.slug)) - Number(first.has(a.slug)))
        )
    }, [addedSlugs, first, registry])
    const visible = useMemo(() => filterSkillOptions(options, search), [options, search])
    const searching = Boolean(search.trim())

    return (
        <div className="flex flex-1 flex-col gap-3 px-4 pb-3 pt-3.5">
            <p className="m-0 text-body text-muted-foreground">
                {t("skills.agent.addDescription")}
            </p>
            <div className="flex items-center gap-2">
                <SearchInput
                    size="compact-search"
                    placeholder={t("skills.gallery.searchPlaceholder")}
                    aria-label={t("skills.gallery.searchAria")}
                    value={search}
                    onValueChange={setSearch}
                />
                <Button variant="outline" size="compact" onClick={onNewSkill} className="shrink-0">
                    <Plus size={14} />
                    {t("skills.agent.newSkill")}
                </Button>
            </div>
            {query.isPending ? (
                <RowsSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState
                    image="simple"
                    title={
                        searching
                            ? t("skills.gallery.noMatchTitle")
                            : t("skills.gallery.noSkillsTitle")
                    }
                    description={
                        searching
                            ? t("skills.gallery.noMatchName")
                            : t("skills.gallery.createBelow")
                    }
                >
                    {searching ? null : (
                        <Button variant="outline" size="compact" onClick={onNewSkill}>
                            <Plus size={14} />
                            {t("skills.agent.newSkill")}
                        </Button>
                    )}
                </EmptyState>
            ) : (
                <div className="-mx-3 flex flex-col gap-2">
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
