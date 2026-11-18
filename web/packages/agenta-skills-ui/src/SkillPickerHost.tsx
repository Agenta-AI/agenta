import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {buildSkillEmbedEntry, querySkills, type SkillRegistryItem} from "@agenta/skills"
import {skillsListDataAtom, skillsListQueryAtom} from "@agenta/skills/state"
import type {SkillsPickerHostProps} from "@agenta/ui/drill-in"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {cn} from "@agenta/ui/styles"
import {Button, SearchInput, Spinner} from "@agenta/ui/ui"
import {
    ArrowLeft,
    Check,
    CheckCircle,
    Compass,
    PencilSimple,
    Plus,
    X,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SkillCandidateList} from "./SkillCandidateList"
import {SkillCreateChooser} from "./SkillCreateChooser"
import {SkillEditor} from "./SkillEditor"
import {SkillGithubImport, type ImportedSkill} from "./SkillGithubImport"
import {filterSkillOptions, pickerEmbedEntry, toPickerItem} from "./pickerOptions"
import {toSourceInfo} from "./registrySections"
import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"
import {useSkillCreateFlow, type CreatedSkill} from "./useSkillCreateFlow"

type View = "list" | "create"

const ROW = "relative flex h-16 items-center gap-3 rounded-[10px] px-2.5 transition-colors hover:bg-accent/60"
const TILE =
    "flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-solid border-border bg-muted text-muted-foreground"

const entryFor = (created: {slug: string; workflowId?: string; name: string; description?: string}) =>
    buildSkillEmbedEntry({...created, mode: "latest"}) as unknown as Record<string, unknown>

function Header({
    title,
    description,
    onBack,
    onClose,
}: {
    title: string
    description?: string
    onBack?: () => void
    onClose: () => void
}) {
    return (
        <div className="relative flex flex-col gap-1.5 px-5 pb-4 pt-5">
            <div className="flex items-center gap-1.5 pr-8">
                {onBack ? (
                    <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack} className="-ml-1.5">
                        <ArrowLeft size={16} />
                    </Button>
                ) : null}
                <h2 className="m-0 text-[17px] font-medium leading-6">{title}</h2>
            </div>
            {description ? <p className="m-0 text-sm text-muted-foreground">{description}</p> : null}
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={onClose}
                className="absolute right-3.5 top-3.5"
            >
                <X size={16} />
            </Button>
        </div>
    )
}

function Footer({children}: {children: ReactNode}) {
    return (
        <div className="flex items-center gap-2 border-0 border-t border-solid border-border bg-foreground/[0.02] px-5 py-3.5">
            {children}
        </div>
    )
}

/** The playground's skills drawer: pick registry skills for the agent, or make a new one. */
export function SkillPickerHost({open, onClose, added, onAdd, onRemove, startWith = "list"}: SkillsPickerHostProps) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const query = useAtomValue(skillsListQueryAtom)
    const registry = useAtomValue(skillsListDataAtom)

    const [view, setView] = useState<View>(startWith)
    const [search, setSearch] = useState("")
    const [onAgent, setOnAgent] = useState<Set<string>>(new Set())
    const [initial, setInitial] = useState<Set<string>>(new Set())
    const [notice, setNotice] = useState<string | null>(null)
    const [fresh, setFresh] = useState<Set<string>>(new Set())
    const [importing, setImporting] = useState(false)

    const finishCreate = useCallback(
        (created: CreatedSkill[]) => {
            onAdd(created.map(entryFor))
            const slugs = created.map((skill) => skill.slug)
            setOnAgent((current) => new Set([...current, ...slugs]))
            setInitial((current) => new Set([...current, ...slugs]))
            setFresh(new Set(slugs))
            setNotice(
                created.length === 1
                    ? `${skillTitle({name: created[0].name, slug: created[0].slug})} is created and added to this agent.`
                    : `${created.length} skills are created and added to this agent.`,
            )
            setView("list")
        },
        [onAdd],
    )
    const flow = useSkillCreateFlow({projectId, onCreated: finishCreate})
    const startCreate = (title?: string) => {
        if (title) flow.write(title)
        else flow.reset()
        setView("create")
    }
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            const slugs = new Set(added.map((entry) => entry.slug))
            setView(startWith)
            setSearch("")
            setOnAgent(slugs)
            setInitial(slugs)
            setNotice(null)
            setFresh(new Set())
            if (startWith === "create") flow.reset()
        }
    }

    useEffect(() => {
        if (!fresh.size) return
        const timer = setTimeout(() => setFresh(new Set()), 2800)
        return () => clearTimeout(timer)
    }, [fresh])

    const finishImport = useCallback(
        async (imported: ImportedSkill[]) => {
            setImporting(true)
            try {
                const latest = await querySkills({projectId})
                const byId = new Map(
                    latest.skills.map((item: SkillRegistryItem) => [item.workflow_id ?? "", item]),
                )
                const created = imported.flatMap((skill) => {
                    const item = byId.get(skill.workflowId ?? "")
                    if (!item?.workflow_slug) return []
                    return [
                        {
                            slug: item.workflow_slug,
                            workflowId: item.workflow_id ?? undefined,
                            name: item.skill_name ?? item.name ?? item.workflow_slug,
                            description: item.description ?? undefined,
                        },
                    ]
                })
                finishCreate(created)
                if (created.length)
                    setNotice(
                        created.length === 1
                            ? `${skillTitle({name: created[0].name, slug: created[0].slug})} is imported and added to this agent.`
                            : `${created.length} skills are imported and added to this agent.`,
                    )
            } finally {
                setImporting(false)
            }
        },
        [finishCreate, projectId],
    )

    const options = useMemo<SkillListItem[]>(() => {
        const none = new Map<string, {pinnedVersion?: string}>()
        return registry
            .filter((item) => !item.archived)
            .map((item) => {
                const mapped = toPickerItem(item, item.origin ? "imported" : "project", none)
                if (!mapped) return null
                return item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
            })
            .filter((item): item is SkillListItem => item !== null)
    }, [registry])

    const visible = filterSkillOptions(options, search)
    const groups = search.trim()
        ? [{label: null, rows: visible}]
        : [
              {label: "On this agent", rows: visible.filter((o) => initial.has(o.slug))},
              {label: "Other skills", rows: visible.filter((o) => !initial.has(o.slug))},
          ].filter((group) => group.rows.length)

    const toggle = (slug: string) =>
        setOnAgent((current) => {
            const next = new Set(current)
            if (!next.delete(slug)) next.add(slug)
            return next
        })

    const done = () => {
        const toAdd = options.filter((o) => onAgent.has(o.slug) && !initial.has(o.slug))
        const toRemove = [...initial].filter((slug) => !onAgent.has(slug))
        if (toAdd.length) onAdd(toAdd.map((o) => pickerEmbedEntry(o, "latest")))
        if (toRemove.length) onRemove(toRemove)
        onClose()
    }

    const writing = view === "create" && flow.step === "write"
    const createHeader = (title: string, description?: string) => (
        <Header
            title={title}
            description={description}
            onBack={() => (flow.step === "choose" ? setView("list") : flow.setStep("choose"))}
            onClose={onClose}
        />
    )

    let body: ReactNode
    if (view === "list") {
        body = (
            <>
                <Header title="Add skills" description="Choose skills from the registry for this agent." onClose={onClose} />
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
                    <div className="flex gap-2">
                        <SearchInput
                            placeholder="Search skills"
                            aria-label="Search skills"
                            value={search}
                            onValueChange={setSearch}
                        />
                        <Button className="shrink-0" onClick={() => startCreate()}>
                            <Plus size={14} />
                            New skill
                        </Button>
                    </div>
                    {notice ? (
                        <div role="status" className="flex items-center gap-2 rounded-[10px] bg-tag-green-bg px-3 py-2 text-[13px] text-tag-green">
                            <CheckCircle size={15} weight="fill" className="shrink-0" />
                            <span className="flex-1">{notice}</span>
                        </div>
                    ) : null}
                    <div className="-mx-2.5 flex flex-col gap-0.5">
                        {query.isPending ? (
                            <div className="flex justify-center py-8">
                                <Spinner size="small" />
                            </div>
                        ) : null}
                        {groups.map((group, index) => (
                            <div key={group.label ?? "all"} className="flex flex-col gap-0.5">
                                {group.label ? (
                                    <div className={cn("flex items-center gap-1.5 px-2.5 pb-1.5 pt-1 text-xs font-medium text-muted-foreground", index > 0 && "mt-3.5")}>
                                        <span>{group.label}</span>
                                        <span className="font-normal opacity-80">{group.rows.length}</span>
                                    </div>
                                ) : null}
                                {group.rows.map((option) => {
                                    const on = onAgent.has(option.slug)
                                    const label = `${on ? "Remove from agent" : "Add to agent"}: ${skillTitle(option)}`
                                    return (
                                        <div
                                            key={option.id}
                                            className={cn(ROW, fresh.has(option.slug) && "bg-tag-green-bg")}
                                        >
                                            <span aria-hidden className={TILE}>
                                                <Compass size={16} />
                                            </span>
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className="truncate text-sm font-medium">{skillTitle(option)}</span>
                                                    {option.source ? (
                                                        <span className="truncate text-xs text-muted-foreground">
                                                            {option.source.label}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                                                    {option.description || "No description"}
                                                </span>
                                            </span>
                                            <button
                                                type="button"
                                                aria-pressed={on}
                                                aria-label={label}
                                                title={label}
                                                onClick={() => toggle(option.slug)}
                                                className={cn(
                                                    "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 text-foreground after:absolute after:inset-0 after:content-['']",
                                                    on ? "bg-accent hover:bg-foreground/10" : "bg-transparent hover:bg-accent",
                                                )}
                                            >
                                                {on ? <Check size={15} weight="bold" /> : <Plus size={15} />}
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                        {!query.isPending && !visible.length ? (
                            <div className="flex flex-col items-center gap-2.5 px-2.5 py-8 text-center text-sm text-muted-foreground">
                                {search.trim() ? `No skill matches “${search.trim()}”.` : "No skills in the registry yet."}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => startCreate(search.trim())}
                                >
                                    <PencilSimple size={14} />
                                    {search.trim() ? `Write “${search.trim()}”` : "Write a skill"}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
                <Footer>
                    <span className="flex-1 text-[13px] text-muted-foreground">
                        {onAgent.size} {onAgent.size === 1 ? "skill" : "skills"} on this agent
                    </span>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={done}>Done</Button>
                </Footer>
            </>
        )
    } else if (flow.step === "choose") {
        body = (
            <>
                {createHeader(
                    "New skill",
                    "Choose how you want to start. The new skill is saved to the registry and added to this agent.",
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5">
                    <SkillCreateChooser
                        onWrite={() => flow.write()}
                        onUpload={flow.upload}
                        onImport={() => flow.setStep("github")}
                    />
                    {flow.busy ? <Spinner size="small" /> : null}
                    {flow.error ? <p className="m-0 text-[13px] text-destructive">{flow.error}</p> : null}
                </div>
            </>
        )
    } else if (flow.step === "write") {
        body = (
            <>
                {createHeader(flow.fromUpload ? "Review the upload" : "Write a skill")}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                    <SkillEditor
                        draft={flow.draft}
                        onChange={flow.setDraft}
                        autoFocusTitle={!flow.fromUpload}
                        showMissing={flow.attempted}
                        notices={
                            flow.duplicate ? (
                                <div role="alert" className="rounded-[10px] bg-tag-orange-bg px-3 py-2 text-sm text-tag-orange">
                                    You already have a skill called “{flow.draft.title}”. Creating this one
                                    makes a second copy.
                                </div>
                            ) : null
                        }
                    />
                </div>
                <Footer>
                    <span className={cn("flex-1 text-[13px]", flow.error ? "text-destructive" : "text-muted-foreground")}>
                        {flow.error ?? "Saved to the registry and added to this agent."}
                    </span>
                    <Button variant="outline" onClick={() => flow.setStep("choose")}>
                        Cancel
                    </Button>
                    <Button onClick={() => void flow.create()} disabled={!flow.canCreate}>
                        {flow.busy ? <Spinner size="small" /> : null}
                        Create and add
                    </Button>
                </Footer>
            </>
        )
    } else if (flow.step === "upload") {
        body = (
            <>
                {createHeader("Review the upload", "Pick the skills to save and add to this agent.")}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                    <SkillCandidateList
                        candidates={flow.uploadCandidates}
                        selected={flow.picked}
                        onToggle={flow.togglePick}
                        disabled={flow.busy}
                    />
                </div>
                <Footer>
                    <span className="flex-1 text-[13px] text-destructive">{flow.error}</span>
                    <Button onClick={() => void flow.importUploads()} disabled={!flow.picked.size || flow.busy}>
                        {flow.busy ? <Spinner size="small" /> : null}
                        Add {flow.picked.size} {flow.picked.size === 1 ? "skill" : "skills"}
                    </Button>
                </Footer>
            </>
        )
    } else {
        body = (
            <>
                {createHeader("Import from GitHub", "Paste a public repository link. We find every skill in its folders.")}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                    {importing ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Spinner size="small" />
                            Adding to this agent…
                        </div>
                    ) : (
                        <SkillGithubImport projectId={projectId} showHeader={false} onImported={(skills) => void finishImport(skills)} />
                    )}
                </div>
            </>
        )
    }

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={writing ? 960 : 560}
            closable={false}
            destroyOnClose
            styles={{body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"}}}
        >
            {body}
        </EnhancedDrawer>
    )
}

