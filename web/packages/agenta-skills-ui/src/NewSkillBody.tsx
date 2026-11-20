/** The steps of the "New skill" view; in an agent, `onCreated` adds each new skill to it. */
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    firstBadFile,
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    skillFilesOf,
    SkillFormView,
    SkillViewHeader,
    useSkillViewForm,
    type SkillScanCandidate,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {createT, richText, useT} from "@agenta/i18n"
import skillNewCatalog from "@agenta/i18n/catalogs/entityUi.skillNew"
import skillTemplateCatalog from "@agenta/i18n/catalogs/entityUi.skillTemplate"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import repoImportCatalog from "@agenta/i18n/catalogs/ui.repoImport"
import {projectIdAtom} from "@agenta/shared/state"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {
    buildSkillEmbedEntry,
    createSkillWorkflow,
    importSkillSource,
    scanSkillSource,
    skillContentSchema,
    type SkillSourceImportResponse,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import type {NewSkillBodyProps as BridgeNewSkillBodyProps} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {Button, Checkbox, Input, SkeletonBlock, Spinner} from "@agenta/ui/ui"
import {useViewTitle} from "@agenta/ui/view-stack"
import {
    CaretRight,
    GithubLogo,
    PencilSimple,
    UploadSimple,
    WarningCircle,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

type Skill = Record<string, unknown>

const tNow = createT(skillNewCatalog, skillsGalleryCatalog, repoImportCatalog)

/** Where the view opens: the choice, or straight on one way (the Skills page menu). */
export type NewSkillStart =
    | {step: "choose"}
    | {step: "write"}
    | {step: "import"}
    | {step: "upload"; scan?: Promise<SkillUploadScan>}

/** The bridge's props, with the step to open on; the Skills page gives no `onCreated`. */
export type NewSkillBodyProps = Partial<BridgeNewSkillBodyProps> & {start?: NewSkillStart}

export type NewSkillStep = NewSkillStart["step"]
type Step = NewSkillStep

const EMPTY_SKILL: Skill = {name: "", description: "", body: "", files: []}

const toFormValue = (candidate: SkillScanCandidate): Skill => ({
    name: candidate.skill.name ?? "",
    description: candidate.skill.description ?? "",
    body: candidate.skill.body,
    files: candidate.skill.files,
    ...(candidate.skill.disable_model_invocation ? {disable_model_invocation: true} : {}),
})

const embedEntry = (created: {
    slug: string
    workflowId?: string
    name: string
    description?: string
}): Skill => buildSkillEmbedEntry({...created, mode: "latest"}) as unknown as Skill

/** The server's own sentence for a failure, as the repo import drawer shows it. */
const errorText = (err: unknown): string | null => {
    const body = (err as {body?: {next_step?: unknown; detail?: {next_step?: unknown}}})?.body
    const message = body ? extractApiErrorMessage(body) : null
    const nextStep = body?.next_step ?? body?.detail?.next_step
    if (message) return typeof nextStep === "string" ? `${message} ${nextStep}` : message
    return err instanceof Error && err.message ? err.message : null
}

/** One repo scan row. */
interface RepoCandidate {
    path: string
    name: string
    description?: string | null
    unavailable?: string | null
    imported: boolean
}

const ROW = "box-border flex items-start gap-2.5 rounded-md border border-solid p-2.5"

export function NewSkillBody({start = {step: "choose"}, onCreated}: NewSkillBodyProps) {
    const t = useT(
        skillNewCatalog,
        skillsGalleryCatalog,
        skillTemplateCatalog,
        repoImportCatalog,
        skillViewCatalog,
    )
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [step, setStep] = useState<Step>(start.step)
    const [error, setError] = useState<string | null>(null)

    // Write
    const [value, setValue] = useState<Skill>(EMPTY_SKILL)
    const [baseline, setBaseline] = useState<Skill>(EMPTY_SKILL)
    const [parsedCount, setParsedCount] = useState<number | null>(null)
    const [formKey, setFormKey] = useState(0)

    // Upload
    const [reading, setReading] = useState(false)
    const [over, setOver] = useState(false)
    const [picks, setPicks] = useState<{scan: SkillUploadScan; selected: Set<string>} | null>(null)
    const fileInput = useRef<HTMLInputElement>(null)

    // Import
    const [repoUrl, setRepoUrl] = useState("")
    const [scanning, setScanning] = useState(false)
    const [importing, setImporting] = useState(false)
    const [found, setFound] = useState<RepoCandidate[] | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())

    // A late answer after the view left is dropped.
    const live = useRef(true)
    useEffect(() => {
        live.current = true
        return () => {
            live.current = false
        }
    }, [])

    const openWrite = useCallback((next: Skill, count: number | null) => {
        setValue(next)
        setBaseline(next)
        setFormKey((key) => key + 1)
        setParsedCount(count)
        setError(null)
        setStep("write")
    }, [])

    // Only the latest upload fills the form; an older, slower one is dropped.
    const scanId = useRef(0)
    const takeScan = useCallback(
        async (scan: Promise<SkillUploadScan>) => {
            const id = ++scanId.current
            const current = () => live.current && id === scanId.current
            setReading(true)
            setError(null)
            setPicks(null)
            try {
                const result = await scan
                if (!current()) return
                const [first] = result.candidates
                if (!first) setError(tNow("skills.gallery.noSkillMdFound"))
                else if (result.candidates.length === 1)
                    openWrite(toFormValue(first), result.fileCount)
                else
                    setPicks({
                        scan: result,
                        selected: new Set(result.candidates.map((c) => c.dir)),
                    })
            } catch {
                if (current()) setError(tNow("skills.gallery.readUploadFailed"))
            } finally {
                if (current()) setReading(false)
            }
        },
        [openWrite],
    )

    const startScan = start.step === "upload" ? start.scan : undefined
    // Read the upload the view opened with once.
    const readStart = useRef(startScan)
    useEffect(() => {
        if (readStart.current) void takeScan(readStart.current)
        readStart.current = undefined
    }, [takeScan])

    /** One skill into the registry; returns the embed entry. Throws on failure. */
    const createOne = useCallback(
        async (skill: Skill): Promise<Skill> => {
            const parsed = skillContentSchema.parse(skill)
            const created = await createSkillWorkflow({projectId, skill: parsed})
            return embedEntry({
                slug: created.slug,
                workflowId: created.workflowId,
                name: parsed.name,
                description: parsed.description,
            })
        },
        [projectId],
    )

    const create = useCallback(async () => {
        setError(null)
        try {
            const entry = await createOne(value)
            invalidateSkillsListCache()
            onCreated?.([entry])
            return true
        } catch (err) {
            const detail = errorText(err)
            setError(
                detail
                    ? tNow("skills.gallery.createFailedDetail", {error: detail})
                    : tNow("skills.gallery.createFailed"),
            )
            return false
        }
    }, [createOne, onCreated, value])

    const chosenPicks = useMemo(
        () => (picks ? picks.scan.candidates.filter((c) => picks.selected.has(c.dir)) : []),
        [picks],
    )

    const importPicks = useCallback(async () => {
        setError(null)
        const entries: Skill[] = []
        try {
            for (const candidate of chosenPicks) {
                entries.push(await createOne(toFormValue(candidate)))
                // Off the list once it is in, so a retry cannot create it again.
                setPicks((current) => {
                    if (!current) return current
                    const next = new Set(current.selected)
                    next.delete(candidate.dir)
                    const candidates = current.scan.candidates.filter(
                        (c) => c.dir !== candidate.dir,
                    )
                    return {scan: {...current.scan, candidates}, selected: next}
                })
            }
            return true
        } catch (err) {
            const detail = errorText(err)
            setError(
                detail
                    ? tNow("skills.gallery.importFailedDetail", {error: detail})
                    : tNow("skills.gallery.importFailed"),
            )
            return false
        } finally {
            if (entries.length) {
                invalidateSkillsListCache()
                onCreated?.(entries)
            }
        }
    }, [chosenPicks, createOne, onCreated])

    const scanRepo = useCallback(async () => {
        const url = repoUrl.trim()
        if (!url || scanning || importing) return
        setScanning(true)
        setError(null)
        setFound(null)
        setSelected(new Set())
        try {
            const response = await scanSkillSource({projectId, repoUrl: url})
            if (!live.current) return
            const already = new Set(response?.already_imported_paths ?? [])
            const rows: RepoCandidate[] = (response?.scan?.candidates ?? []).map((c) => {
                const imported = already.has(c.path_in_repo)
                return {
                    path: c.path_in_repo,
                    name: c.skill?.name || c.path_in_repo,
                    description: c.skill?.description,
                    imported,
                    unavailable: imported
                        ? null
                        : c.valid
                          ? null
                          : c.issues
                                ?.map((i) => i.message)
                                .filter(Boolean)
                                .join(" ") || tNow("skills.gallery.invalidSkill"),
                }
            })
            if (rows.length === 0) {
                setError(tNow("skills.gallery.importNoneFound"))
                return
            }
            setFound(rows)
            setSelected(
                new Set(rows.filter((r) => !r.imported && !r.unavailable).map((r) => r.path)),
            )
        } catch (err) {
            if (live.current) setError(errorText(err) ?? tNow("ui.repoImport.scanFailed"))
        } finally {
            if (live.current) setScanning(false)
        }
    }, [importing, projectId, repoUrl, scanning])

    /** The embed entry of each imported skill, from the slug the import answer names. */
    const entriesOfImported = (imported: NonNullable<SkillSourceImportResponse["imported"]>) => {
        const entries: Skill[] = []
        const missed: string[] = []
        for (const item of imported) {
            if (!item.workflow_slug) {
                missed.push(item.name || item.path_in_repo)
                continue
            }
            entries.push(
                embedEntry({
                    slug: item.workflow_slug,
                    workflowId: item.workflow_id ?? undefined,
                    name: item.name ?? item.workflow_slug,
                    description: item.description ?? undefined,
                }),
            )
        }
        return {entries, missed}
    }

    const runImport = useCallback(async () => {
        setError(null)
        let response
        try {
            response = await importSkillSource({
                projectId,
                repoUrl: repoUrl.trim(),
                paths: Array.from(selected),
            })
            if (!response) throw new Error()
        } catch (err) {
            const detail = errorText(err)
            setError(
                detail
                    ? tNow("skills.gallery.importFailedDetail", {error: detail})
                    : tNow("skills.gallery.importFailed"),
            )
            return false
        }
        invalidateSkillsListCache()
        const imported = response.imported ?? []
        const notes: string[] = []
        if (onCreated && imported.length) {
            const {entries, missed} = entriesOfImported(imported)
            if (entries.length) onCreated(entries)
            if (missed.length)
                notes.push(tNow("entityUi.skillNew.notAddedToAgent", {names: missed.join(", ")}))
        }
        const skipped = response.skipped ?? []
        if (skipped.length)
            notes.push(
                [
                    tNow("skills.gallery.skippedCount", {count: skipped.length}),
                    ...skipped.map((s) => s.path_in_repo),
                ].join(" "),
            )
        if (notes.length === 0) return true
        // Some went in: keep the view open, mark them imported and say what did not.
        const done = new Set(imported.map((item) => item.path_in_repo))
        setFound((rows) =>
            rows ? rows.map((row) => (done.has(row.path) ? {...row, imported: true} : row)) : rows,
        )
        setSelected(new Set())
        setError(notes.join(" "))
        return "stay" as const
    }, [onCreated, projectId, repoUrl, selected])
    const importRepo = useCallback(async () => {
        setImporting(true)
        try {
            return await runImport()
        } finally {
            setImporting(false)
        }
    }, [runImport])

    const writeDirty = JSON.stringify(value) !== JSON.stringify(EMPTY_SKILL)
    const writeValid =
        skillContentSchema.safeParse(value).success &&
        firstBadFile(skillFilesOf(value)) === undefined
    const form =
        step === "write"
            ? {
                  dirty: writeDirty,
                  valid: writeValid,
                  label: t("skills.gallery.createSkill"),
                  save: create,
              }
            : step === "upload" && picks
              ? {
                    dirty: true,
                    valid: chosenPicks.length > 0,
                    label: t("skills.gallery.importSkills", {count: chosenPicks.length}),
                    save: importPicks,
                }
              : step === "import" && found
                ? {
                      dirty: selected.size > 0,
                      valid: selected.size > 0,
                      label: t("skills.gallery.importSkills", {count: selected.size}),
                      save: importRepo,
                  }
                : {
                      dirty: false,
                      valid: false,
                      label: t("skills.gallery.createSkill"),
                      save: async () => false,
                  }
    const {onUploadControl} = useSkillViewForm(
        {
            dirty: form.dirty,
            valid: form.valid,
            saveLabel: form.label,
            leaveDescription: t("entityUi.skillNew.leaveDescription"),
            save: form.save,
            // "Choose how" has no action row: a card click goes on (F07 f12).
            ...(step === "choose" ? {actionRow: false as const} : {}),
        },
        t("entityUi.skillView.upload"),
    )

    const stepLabel: Record<Step, string> = {
        choose: "",
        write: t("entityUi.skillNew.stepWrite"),
        upload: t("skills.gallery.menuUploadTitle"),
        import: t("entityUi.skillNew.stepImport"),
    }
    useViewTitle(
        step === "choose"
            ? t("skills.gallery.newSkill")
            : t("entityUi.skillNew.stepTitle", {step: stepLabel[step]}),
    )

    const errorLine = error ? (
        <span role="alert" className="flex items-start gap-1.5 text-xs text-colorError">
            <WarningCircle size={14} className="mt-px shrink-0" />
            <span className="min-w-0">{error}</span>
        </span>
    ) : null

    if (step === "write") {
        const name = typeof value.name === "string" ? value.name.trim() : ""
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <SkillViewHeader
                    name={name || t("skills.gallery.newSkill")}
                    status={
                        parsedCount != null
                            ? t("skills.gallery.filesParsed", {count: parsedCount})
                            : t("entityUi.skillNew.notSavedYet")
                    }
                    actions={[]}
                    error={error}
                />
                <div className="min-h-0 flex-1">
                    <SkillFormView
                        key={formKey}
                        value={value}
                        onChange={setValue}
                        baseline={baseline}
                        autoFocusName={parsedCount == null}
                        showMissing={writeDirty && !writeValid}
                        onUploadControl={onUploadControl}
                    />
                </div>
            </div>
        )
    }

    if (step === "upload") {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
                {picks ? (
                    <UploadPicks
                        picks={picks}
                        onToggle={(dir) =>
                            setPicks((current) => {
                                if (!current) return current
                                const next = new Set(current.selected)
                                if (!next.delete(dir)) next.add(dir)
                                return {...current, selected: next}
                            })
                        }
                    />
                ) : (
                    <div
                        onDragOver={(e) => {
                            e.preventDefault()
                            setOver(true)
                        }}
                        onDragLeave={() => setOver(false)}
                        onDrop={(e) => {
                            e.preventDefault()
                            setOver(false)
                            void takeScan(scanSkillFromDataTransfer(e.dataTransfer))
                        }}
                        className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-colorBorderSecondary px-4 py-8 text-center transition-colors",
                            over && "border-colorBorder bg-colorFillTertiary",
                        )}
                    >
                        {reading ? (
                            <Spinner size="small" />
                        ) : (
                            <UploadSimple size={20} className="text-colorTextSecondary" />
                        )}
                        <span className="text-xs text-colorTextSecondary">
                            {richText(t("entityUi.skillTemplate.dragHint"), {
                                mono: (text) => <span className="font-mono">{text}</span>,
                            })}
                        </span>
                        <span className="text-xs text-colorTextTertiary">
                            {t("entityUi.skillNew.or")}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={reading}
                            onClick={() => fileInput.current?.click()}
                        >
                            {t("entityUi.skillTemplate.browseFiles")}
                        </Button>
                        <input
                            ref={fileInput}
                            type="file"
                            multiple
                            accept=".zip,.skill,.md,text/markdown,text/plain"
                            className="hidden"
                            aria-hidden
                            tabIndex={-1}
                            onChange={(event) => {
                                const list = event.target.files
                                if (list && list.length) void takeScan(scanSkillFromFileList(list))
                                event.target.value = ""
                            }}
                        />
                    </div>
                )}
                <span className="text-xs text-colorTextSecondary">
                    {t("entityUi.skillNew.uploadLine")}
                </span>
                {errorLine}
            </div>
        )
    }

    if (step === "import") {
        return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
                <span className="text-xs text-colorTextSecondary">
                    {t("skills.gallery.importDrawerHint")}
                </span>
                <div className="flex items-center gap-2">
                    <Input
                        autoFocus
                        value={repoUrl}
                        aria-label={t("ui.repoImport.repositoryUrl")}
                        placeholder="https://github.com/owner/repo"
                        onChange={(e) => {
                            setRepoUrl(e.target.value)
                            setFound(null)
                            setSelected(new Set())
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void scanRepo()
                        }}
                        disabled={scanning || importing}
                    />
                    <Button
                        variant="outline"
                        className="shrink-0"
                        onClick={() => void scanRepo()}
                        disabled={scanning || importing || !repoUrl.trim()}
                    >
                        {scanning ? <Spinner size="small" /> : null}
                        {t("entityUi.skillNew.scan")}
                    </Button>
                </div>
                {scanning ? <ScanSkeleton /> : null}
                {found ? (
                    <div className="flex flex-col gap-1.5 text-xs">
                        <span className="font-medium">
                            {t("skills.gallery.skillsFound", {count: found.length})}
                        </span>
                        {found.map((row) => {
                            const locked = row.imported || Boolean(row.unavailable)
                            return (
                                <label
                                    key={row.path}
                                    className={cn(
                                        ROW,
                                        "border-colorBorderSecondary",
                                        locked ? "opacity-60" : "cursor-pointer",
                                    )}
                                >
                                    <Checkbox
                                        className="mt-0.5"
                                        checked={selected.has(row.path)}
                                        disabled={locked}
                                        onCheckedChange={() =>
                                            setSelected((current) => {
                                                const next = new Set(current)
                                                if (!next.delete(row.path)) next.add(row.path)
                                                return next
                                            })
                                        }
                                        aria-label={t("skills.gallery.importAria", {
                                            name: row.name,
                                        })}
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            <span className="min-w-0 truncate font-medium">
                                                {row.name}
                                            </span>
                                            {row.imported ? (
                                                <span className="shrink-0 rounded bg-colorFillTertiary px-1.5 py-px text-[10px] text-colorTextTertiary">
                                                    {t("skills.gallery.alreadyImported")}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="line-clamp-1 text-colorTextSecondary">
                                            {row.unavailable ??
                                                (row.description ||
                                                    t("skills.gallery.noDescription"))}
                                        </span>
                                    </span>
                                </label>
                            )
                        })}
                    </div>
                ) : null}
                {errorLine}
            </div>
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {onCreated ? (
                <span className="text-xs text-colorTextSecondary">
                    {t("entityUi.skillNew.chooseLine")}
                </span>
            ) : null}
            <div className="flex flex-col gap-2">
                <WayRow
                    icon={<PencilSimple size={14} />}
                    title={t("skills.gallery.menuWriteTitle")}
                    hint={t("skills.gallery.menuWriteHint")}
                    onSelect={() => openWrite(EMPTY_SKILL, null)}
                />
                <WayRow
                    icon={<UploadSimple size={14} />}
                    title={t("skills.gallery.menuUploadTitle")}
                    hint={t("skills.gallery.menuUploadHint")}
                    onSelect={() => setStep("upload")}
                />
                <WayRow
                    icon={<GithubLogo size={14} />}
                    title={t("skills.gallery.menuImportTitle")}
                    hint={t("skills.gallery.menuImportHint")}
                    onSelect={() => setStep("import")}
                />
            </div>
        </div>
    )
}

function WayRow({
    icon,
    title,
    hint,
    onSelect,
}: {
    icon: ReactNode
    title: string
    hint: string
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className="box-border flex w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary bg-transparent p-3 text-left font-[inherit] outline-none transition-colors hover:bg-colorFillTertiary focus-visible:bg-colorFillTertiary"
        >
            {/* An icon tile and a chevron: a click goes on to that way (F07 f12). */}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-solid border-colorBorderSecondary bg-colorFillQuaternary text-colorText">
                {icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-colorText">{title}</span>
                <span className="text-[12px] leading-4 text-colorTextSecondary">{hint}</span>
            </span>
            <CaretRight aria-hidden size={14} className="shrink-0 text-colorTextTertiary" />
        </button>
    )
}

function UploadPicks({
    picks,
    onToggle,
}: {
    picks: {scan: SkillUploadScan; selected: Set<string>}
    onToggle: (dir: string) => void
}) {
    const t = useT(skillsGalleryCatalog)
    return (
        <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium">
                {t("skills.gallery.skillsFound", {count: picks.scan.candidates.length})}
            </span>
            {picks.scan.candidates.map((candidate) => (
                <label
                    key={candidate.dir}
                    className={cn(ROW, "cursor-pointer border-colorBorderSecondary")}
                >
                    <Checkbox
                        className="mt-0.5 rounded"
                        checked={picks.selected.has(candidate.dir)}
                        onCheckedChange={() => onToggle(candidate.dir)}
                        aria-label={t("skills.gallery.importAria", {
                            name: candidate.skill.name || candidate.dir,
                        })}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-mono">
                            {candidate.skill.name || candidate.dir || t("skills.gallery.unnamed")}
                        </span>
                        <span className="line-clamp-1 text-colorTextSecondary">
                            {candidate.skill.description ||
                                candidate.dir ||
                                t("skills.gallery.noDescription")}
                        </span>
                    </span>
                </label>
            ))}
        </div>
    )
}

function ScanSkeleton() {
    return (
        <div aria-hidden className="flex flex-col gap-1">
            {[0, 1, 2].map((row) => (
                <div key={row} className={cn(ROW, "border-colorBorderSecondary")}>
                    <SkeletonBlock active className="mt-0.5 size-4 rounded" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-2/5 rounded" />
                        <SkeletonBlock active className="h-3.5 w-4/5 rounded" />
                    </span>
                </div>
            ))}
        </div>
    )
}

export default NewSkillBody
