/** The registry list of the agent's "Add skills" view: the agent's skills, then all the others. */
import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import type {AddSkillsBodyProps} from "@agenta/editor/drill-in"
import {CatalogGroupSkeleton, CatalogListRow} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {skillsResolveDataAtom, skillsResolveQueryAtom} from "@agenta/skills/state"
import {SkillMark} from "@agenta/ui/agent-icon"
import {SearchInput, SimpleTooltip} from "@agenta/ui/composed"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {
    Alert,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Check, DotsThreeVertical, MagnifyingGlass, Plus, Trash} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {filterSkillOptions, pickerEmbedEntry, toPickerItem} from "./pickerOptions"
import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

const useCatalogT = () =>
    useT(
        skillsGalleryCatalog,
        skillsAgentCatalog,
        skillsListCatalog,
        commonCatalog,
        integrationViewsCatalog,
        uiControlsCatalog,
    )

/** The catalog's quiet row action: `secondary` stacks on the row's hover fill (SURF-06). */
const ROW_ACTION = "text-muted-foreground hover:bg-secondary hover:text-foreground"

/** A skill on the agent: "✓ Added" and a menu that removes it, as a connected app's row. */
function AddedRow({option, onRemove}: {option: SkillListItem; onRemove: () => void}) {
    const t = useCatalogT()
    const title = skillTitle(option)
    return (
        <CatalogListRow
            variant="canvas"
            leading={<SkillMark size={32} />}
            title={title}
            action={
                <span className="flex items-center gap-1">
                    <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                        <Check size={14} />
                        {t("skills.agent.added")}
                    </span>
                    <DropdownMenu>
                        <SimpleTooltip title={t("ui.controls.moreActions")}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("ui.controls.moreActions")}
                                    className={`${ROW_ACTION} aria-expanded:bg-secondary`}
                                >
                                    <DotsThreeVertical aria-hidden />
                                </Button>
                            </DropdownMenuTrigger>
                        </SimpleTooltip>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onSelect={onRemove}
                                aria-label={t("skills.agent.removeSkillFromAgent", {name: title})}
                            >
                                <Trash />
                                {t("entityUi.integrationViews.removeFromAgent")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </span>
            }
        >
            <Description option={option} />
        </CatalogListRow>
    )
}

/** A skill not on the agent: the row and its "+" add it, as an app in "All apps". */
function AvailableRow({option, onAdd}: {option: SkillListItem; onAdd: () => void}) {
    const t = useCatalogT()
    const label = t("skills.agent.addSkillToAgent", {name: skillTitle(option)})
    return (
        <CatalogListRow
            variant="canvas"
            onClick={onAdd}
            actionLabel={label}
            leading={<SkillMark size={32} />}
            title={skillTitle(option)}
            action={
                <SimpleTooltip title={t("common.add")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        // Shown on row hover and focus, always on touch (TOUCH-02).
                        className={`${ROW_ACTION} focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0`}
                        aria-label={label}
                        onClick={onAdd}
                    >
                        <Plus />
                    </Button>
                </SimpleTooltip>
            }
        >
            <Description option={option} />
        </CatalogListRow>
    )
}

function Description({option}: {option: SkillListItem}) {
    const t = useCatalogT()
    const text = option.description?.trim() || t("skills.gallery.noDescription")
    return (
        <span className="truncate text-meta text-muted-foreground" title={text}>
            {text}
        </span>
    )
}

/** The agent panel's group header, as the integration catalog's (canvas F02 f4). */
function GroupHeader({children}: {children: ReactNode}) {
    return <div className="flex items-center pt-3 text-subtitle text-foreground">{children}</div>
}

function RowGroup({label, children}: {label: ReactNode; children: ReactNode}) {
    return (
        <div className="flex flex-col">
            <GroupHeader>{label}</GroupHeader>
            {/* -mx/px: the rows' hover fill and focus ring stay inside the scroll's clip. */}
            <div className="-mx-2 flex flex-col gap-2 px-2 pt-2">{children}</div>
        </div>
    )
}

/** The loading list: Added, then All skills. */
function AddSkillsListSkeleton() {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            <CatalogGroupSkeleton rows={3} />
            <CatalogGroupSkeleton rows={3} />
        </div>
    )
}

export function AddSkillsBody({addedSlugs, onAdd, onRemove, onNewSkill}: AddSkillsBodyProps) {
    const t = useCatalogT()
    // The unfiltered registry: the Skills page search must not narrow this list.
    const query = useAtomValue(skillsResolveQueryAtom)
    const registry = useAtomValue(skillsResolveDataAtom)
    const [search, setSearch] = useState("")
    // The registry as first loaded: a skill made after that (a new skill) goes on top.
    const [known, setKnown] = useState<Set<string> | null>(null)
    if (known === null && !query.isPending) {
        setKnown(
            new Set(registry.flatMap((item) => (item.workflow_slug ? [item.workflow_slug] : []))),
        )
    }

    const options = useMemo<SkillListItem[]>(() => {
        const added = new Map(addedSlugs.map((slug) => [slug, {}]))
        const rank = (slug: string) => (known && !known.has(slug) ? 0 : 1)
        return registry
            .filter((item) => !item.archived)
            .map((item) =>
                toPickerItem(
                    item,
                    item.origin && !item.origin.detached ? "imported" : "project",
                    added,
                ),
            )
            .filter((item): item is SkillListItem => item !== null)
            .sort((a, b) => rank(a.slug) - rank(b.slug))
    }, [addedSlugs, known, registry])
    const visible = useMemo(() => filterSkillOptions(options, search), [options, search])
    const onAgent = visible.filter((option) => option.added)
    const others = visible.filter((option) => !option.added)

    // A click opened the view: move focus into it, so Escape and Tab start here.
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const root = rootRef.current
        if (root && !root.contains(document.activeElement)) root.focus({preventScroll: true})
    }, [])
    const listRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(listRef)

    const searching = Boolean(search.trim())
    const failed = query.isError && registry.length === 0

    return (
        <div ref={rootRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col pt-3 outline-none">
            {/* Fixed above the scroll. pt-1 keeps the focus ring inside the body's clip. */}
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                <SearchInput
                    className="min-w-0 flex-1 border-border-muted"
                    placeholder={t("skills.gallery.searchPlaceholder")}
                    aria-label={t("skills.gallery.searchAria")}
                    value={search}
                    onValueChange={setSearch}
                />
                <Button variant="outline" onClick={onNewSkill} className="shrink-0">
                    <Plus />
                    {t("skills.agent.newSkill")}
                </Button>
            </div>
            <div
                ref={listRef}
                className="ag-scroll-fade flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3"
            >
                {query.isPending ? (
                    <AddSkillsListSkeleton />
                ) : failed ? (
                    <Alert
                        type="warning"
                        showIcon
                        className="mt-3"
                        message={t("skills.list.loadFailed")}
                        description={t("skills.list.loadFailedBody")}
                        action={
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void query.refetch()}
                            >
                                {t("common.retry")}
                            </Button>
                        }
                    />
                ) : visible.length === 0 ? (
                    <Empty className="py-10">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <MagnifyingGlass />
                            </EmptyMedia>
                            <EmptyTitle>
                                {searching
                                    ? t("skills.gallery.noMatchTitle")
                                    : t("skills.gallery.noSkillsTitle")}
                            </EmptyTitle>
                            <EmptyDescription>
                                {searching
                                    ? t("skills.gallery.noMatchName")
                                    : t("skills.gallery.createBelow")}
                            </EmptyDescription>
                        </EmptyHeader>
                        {searching ? (
                            <EmptyContent>
                                <Button variant="outline" onClick={() => setSearch("")}>
                                    {t("common.clearSearch")}
                                </Button>
                            </EmptyContent>
                        ) : null}
                    </Empty>
                ) : (
                    <>
                        {onAgent.length > 0 ? (
                            <RowGroup label={t("skills.agent.addedGroup")}>
                                {onAgent.map((option) => (
                                    <AddedRow
                                        key={option.id}
                                        option={option}
                                        onRemove={() => onRemove(option.slug)}
                                    />
                                ))}
                            </RowGroup>
                        ) : null}
                        {others.length > 0 ? (
                            <RowGroup label={t("skills.agent.allSkills")}>
                                {others.map((option) => (
                                    <AvailableRow
                                        key={option.id}
                                        option={option}
                                        onAdd={() => onAdd(pickerEmbedEntry(option, "latest"))}
                                    />
                                ))}
                            </RowGroup>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    )
}

export default AddSkillsBody
