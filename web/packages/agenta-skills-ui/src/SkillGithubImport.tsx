import {useMemo, useRef, useState} from "react"

import {extractApiErrorMessage, formatCount, skillDisplayName} from "@agenta/shared/utils"
import {importSkillSource, scanSkillSource} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {Button, Input, SkeletonBlock, Spinner} from "@agenta/ui/ui"
import {GithubLogo, WarningCircle} from "@phosphor-icons/react"

import {SkillCandidateList, type SkillCandidate, type UnavailableSkill} from "./SkillCandidateList"

export interface ImportedSkill {
    workflowId?: string
    name?: string
}

interface Found {
    repo: string
    candidates: SkillCandidate[]
    unavailable: UnavailableSkill[]
}

const errorText = (err: unknown, fallback: string) => extractApiErrorMessage(err) || `${fallback}.`

const repoLabel = (url: string) =>
    url
        .trim()
        .replace(/^https?:\/\/(www\.)?github\.com\//, "")
        .replace(/\.git$|\/$/g, "")

/** Paste a repo link, pick the skills it holds, import them into the registry. */
export function SkillGithubImport({
    projectId,
    onImported,
    showHeader = true,
}: {
    projectId: string
    onImported: (imported: ImportedSkill[]) => void
    showHeader?: boolean
}) {
    const [url, setUrl] = useState("")
    const [found, setFound] = useState<Found | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState<"scan" | "import" | null>(null)
    const listRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(listRef, {enabled: Boolean(found?.candidates.length)})
    const [error, setError] = useState<string | null>(null)

    const find = async () => {
        setBusy("scan")
        setError(null)
        try {
            const response = await scanSkillSource({
                projectId,
                repoUrl: url.trim(),
            })
            const already = new Set(response?.already_imported_paths ?? [])
            const candidates: SkillCandidate[] = []
            const unavailable: UnavailableSkill[] = []
            for (const c of response?.scan?.candidates ?? []) {
                const title = c.skill?.name ? skillDisplayName(c.skill.name) : c.path_in_repo
                if (already.has(c.path_in_repo))
                    unavailable.push({key: c.path_in_repo, title, reason: "Already added"})
                else if (!c.valid)
                    unavailable.push({key: c.path_in_repo, title, reason: "Can't be added"})
                else
                    candidates.push({
                        key: c.path_in_repo,
                        title,
                        description: c.skill?.description,
                    })
            }
            setFound({repo: repoLabel(url), candidates, unavailable})
            setPicked(new Set(candidates.slice(0, 1).map((c) => c.key)))
        } catch (err) {
            setError(errorText(err, "Could not read the repository"))
        } finally {
            setBusy(null)
        }
    }

    const runImport = async () => {
        setBusy("import")
        setError(null)
        try {
            const response = await importSkillSource({
                projectId,
                repoUrl: url.trim(),
                paths: [...picked],
            })
            invalidateSkillsListCache()
            const imported = (response?.imported ?? []).map((entry) => ({
                workflowId: entry.workflow_id ?? undefined,
                name: entry.name ?? undefined,
            }))
            if (!imported.length) {
                setError("None of the chosen skills could be imported.")
                return
            }
            onImported(imported)
        } catch (err) {
            setError(errorText(err, "Import failed"))
        } finally {
            setBusy(null)
        }
    }

    const allPicked = Boolean(found?.candidates.length) && picked.size === found?.candidates.length
    const toggle = (key: string) =>
        setPicked((current) => {
            const next = new Set(current)
            if (!next.delete(key)) next.add(key)
            return next
        })
    const importLabel = useMemo(
        () =>
            picked.size ? `Import ${formatCount(picked.size, "skill")}` : "Choose skills to import",
        [picked.size],
    )

    return (
        <div className="flex flex-col gap-5 lg:min-h-0 lg:flex-1">
            {showHeader ? (
                <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground text-background">
                        <GithubLogo size={18} weight="fill" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h1 className="m-0 text-xl font-semibold leading-7">Import from GitHub</h1>
                        <p className="m-0 text-sm text-muted-foreground">
                            Paste a public repository link. We find every skill in its folders.
                        </p>
                    </div>
                </div>
            ) : null}
            <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (url.trim() && !busy) void find()
                }}
            >
                <label className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
                    <span className="text-sm font-medium">Repository link</span>
                    <Input
                        autoFocus
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://github.com/owner/repo"
                    />
                </label>
                <Button
                    type="submit"
                    variant={found ? "outline" : "default"}
                    disabled={!url.trim() || busy !== null}
                >
                    {busy === "scan" ? <Spinner size="small" /> : null}
                    {found ? "Search again" : "Find skills"}
                </Button>
            </form>

            {error ? (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-[10px] bg-tag-red-bg px-3 py-2 text-[13px] text-tag-red"
                >
                    <WarningCircle size={16} className="mt-px shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            {busy === "scan" ? (
                <div aria-busy className="flex flex-col gap-1.5 pt-1">
                    <SkeletonBlock active className="mb-1.5 h-4 w-48 rounded" />
                    {[0, 1, 2, 3, 4].map((row) => (
                        <div
                            key={row}
                            className="box-border flex h-14 items-center gap-2.5 rounded-[10px] border border-solid border-border px-3"
                        >
                            <SkeletonBlock active className="size-7 shrink-0 rounded-lg" />
                            <span className="flex flex-1 flex-col gap-1.5">
                                <SkeletonBlock active className="h-3.5 w-32 rounded" />
                                <SkeletonBlock active className="h-3 w-3/4 rounded" />
                            </span>
                        </div>
                    ))}
                </div>
            ) : found ? (
                <div className="flex animate-skill-enter flex-col gap-3 lg:min-h-0 lg:flex-1">
                    <div className="flex items-center gap-2 pt-1">
                        <span className="flex-1 text-sm text-muted-foreground">
                            {found.candidates.length ? (
                                <>
                                    Found{" "}
                                    <b className="font-medium text-foreground">
                                        {found.candidates.length} new{" "}
                                        {found.candidates.length === 1 ? "skill" : "skills"}
                                    </b>{" "}
                                    in {found.repo}
                                </>
                            ) : (
                                <>No new skills in {found.repo}.</>
                            )}
                        </span>
                        {found.candidates.length > 1 ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    setPicked(
                                        allPicked
                                            ? new Set()
                                            : new Set(found.candidates.map((c) => c.key)),
                                    )
                                }
                            >
                                {allPicked ? "Clear all" : "Select all"}
                            </Button>
                        ) : null}
                    </div>
                    <div
                        ref={listRef}
                        className="ag-scroll-fade -mx-1 px-1 py-px lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                    >
                        <SkillCandidateList
                            candidates={found.candidates}
                            selected={picked}
                            onToggle={toggle}
                            unavailable={found.unavailable}
                            disabled={busy !== null}
                        />
                    </div>
                    {found.candidates.length ? (
                        <div className="flex flex-wrap items-center gap-4 border-0 border-t border-solid border-border pt-3">
                            <span className="flex-[1_1_240px] text-xs text-muted-foreground">
                                Skills that run programs can change files and reach the internet.
                                Add them only from sources you trust.
                            </span>
                            <Button
                                type="button"
                                onClick={() => void runImport()}
                                disabled={!picked.size || busy !== null}
                            >
                                {busy === "import" ? <Spinner size="small" /> : null}
                                {importLabel}
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
