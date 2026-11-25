import {useState} from "react"

import {createT, richText, useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {importSkillSource, scanSkillSource, type ScanCandidate} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {Alert, Button, Field, Input, LoadingButton, SkeletonRows} from "@agenta/ui/ui"

import {SkillCandidateList, type SkillCandidate, type UnavailableSkill} from "./SkillCandidateList"

export interface ImportedSkill {
    workflowSlug?: string
    name?: string
    workflowId?: string
    description?: string
}

interface Found {
    /** The link that was scanned; the import uses it, not the edited field. */
    url: string
    repo: string
    candidates: SkillCandidate[]
    unavailable: UnavailableSkill[]
}

const tNow = createT(skillsEditorCatalog)

const GITHUB_REPO = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i

/** The server's message, said for a person: a missing repo and a bad link get plain words. */
const errorText = (err: unknown, fallback: string) => {
    const raw = extractApiErrorMessage(err)
    if (/returned 404|not exist|is private/i.test(raw ?? ""))
        return tNow("skills.editor.repoNotFound")
    if (/not a github repository/i.test(raw ?? "")) return tNow("skills.editor.notARepo")
    return raw || fallback
}

const repoLabel = (url: string) =>
    url
        .trim()
        .replace(/^https?:\/\/(www\.)?github\.com\//, "")
        .replace(/(\.git)?\/?$/, "")

const runsPrograms = (candidate: ScanCandidate) => {
    const skill = candidate.skill as Record<string, unknown> | null | undefined
    if (skill?.allow_executable_files) return true
    const files = Array.isArray(skill?.files) ? (skill.files as {executable?: boolean}[]) : []
    return files.some((file) => file?.executable)
}

/** Paste a repo link, pick the skills it holds, import them into the registry. */
export function SkillGithubImport({
    projectId,
    onImported,
}: {
    projectId: string
    onImported: (imported: ImportedSkill[]) => void
}) {
    const t = useT(skillsEditorCatalog)
    const [url, setUrl] = useState("")
    const [found, setFound] = useState<Found | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState<"scan" | "import" | null>(null)
    const [error, setError] = useState<string | null>(null)

    const find = async () => {
        const repoUrl = url.trim()
        if (!GITHUB_REPO.test(repoUrl)) {
            setError(t("skills.editor.notARepo"))
            return
        }
        setBusy("scan")
        setError(null)
        // A new search drops the last result, so a failed one cannot import the old repo.
        setFound(null)
        try {
            const response = await scanSkillSource({projectId, repoUrl})
            const already = new Set(response?.already_imported_paths ?? [])
            const candidates: SkillCandidate[] = []
            const unavailable: UnavailableSkill[] = []
            for (const c of response?.scan?.candidates ?? []) {
                const title = c.skill?.name || c.path_in_repo
                if (already.has(c.path_in_repo))
                    unavailable.push({
                        key: c.path_in_repo,
                        title,
                        reason: t("skills.editor.alreadyAdded"),
                    })
                else if (!c.valid)
                    unavailable.push({
                        key: c.path_in_repo,
                        title,
                        reason: t("skills.editor.notValid"),
                        detail: c.issues?.find((issue) => issue.message)?.message ?? undefined,
                    })
                else
                    candidates.push({
                        key: c.path_in_repo,
                        title,
                        description: c.skill?.description,
                        runsPrograms: runsPrograms(c),
                    })
            }
            setFound({url: repoUrl, repo: repoLabel(repoUrl), candidates, unavailable})
            setPicked(new Set())
        } catch (err) {
            setError(errorText(err, t("skills.editor.readRepoFailed")))
        } finally {
            setBusy(null)
        }
    }

    const runImport = async () => {
        if (!found) return
        setBusy("import")
        setError(null)
        try {
            const response = await importSkillSource({
                projectId,
                repoUrl: found.url,
                paths: [...picked],
            })
            invalidateSkillsListCache()
            const imported = (response?.imported ?? []).map((entry) => ({
                workflowSlug: entry.workflow_slug ?? undefined,
                name: entry.name ?? undefined,
                workflowId: entry.workflow_id ?? undefined,
                description: entry.description ?? undefined,
            }))
            if (!imported.length) {
                setError(t("skills.editor.noneImported"))
                return
            }
            const skipped = response?.skipped?.length ?? 0
            if (skipped) {
                const done = t("skills.editor.imported", {count: imported.length})
                message.success(`${done} ${t("skills.editor.skippedCount", {count: skipped})}`)
            }
            onImported(imported)
        } catch (err) {
            setError(errorText(err, t("skills.editor.importFailed")))
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

    return (
        <div className="flex flex-col gap-6">
            {/* One row: the link, then the search. */}
            <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (url.trim() && !busy) void find()
                }}
            >
                <Field label={t("skills.editor.repoLink")} className="min-w-0 flex-[1_1_280px]">
                    <Input
                        autoFocus
                        value={url}
                        onChange={(event) => {
                            setUrl(event.target.value)
                            setError(null)
                        }}
                        placeholder={t("skills.editor.repoLinkPlaceholder")}
                    />
                </Field>
                <LoadingButton
                    type="submit"
                    variant={found ? "outline" : "default"}
                    loading={busy === "scan"}
                    disabled={!url.trim() || busy === "import"}
                >
                    {found ? t("skills.editor.searchAgain") : t("skills.editor.findSkills")}
                </LoadingButton>
            </form>

            {error ? <Alert type="error" showIcon message={error} /> : null}

            {busy === "scan" ? (
                <SkeletonRows count={4} />
            ) : found ? (
                <div className="flex flex-col gap-3">
                    <div className="flex min-h-8 items-center gap-2">
                        <span className="flex-1 text-label text-muted-foreground">
                            {found.candidates.length
                                ? richText(
                                      t("skills.editor.foundNew", {
                                          count: found.candidates.length,
                                          repo: found.repo,
                                      }),
                                      {
                                          b: (text) => (
                                              <span className="font-medium text-foreground">
                                                  {text}
                                              </span>
                                          ),
                                      },
                                  )
                                : t("skills.editor.noNew", {repo: found.repo})}
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
                                {allPicked
                                    ? t("skills.editor.clearAll")
                                    : t("skills.editor.selectAll")}
                            </Button>
                        ) : null}
                    </div>
                    <SkillCandidateList
                        candidates={found.candidates}
                        selected={picked}
                        onToggle={toggle}
                        unavailable={found.unavailable}
                        disabled={busy !== null}
                    />
                    {found.candidates.length ? (
                        <div className="sticky bottom-0 z-sticky mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-0 border-t border-solid border-border-muted bg-background py-3">
                            <span className="flex-[1_1_240px] text-meta text-muted-foreground">
                                {t("skills.editor.trustNote")}
                            </span>
                            <LoadingButton
                                type="button"
                                onClick={() => void runImport()}
                                loading={busy === "import"}
                                disabled={!picked.size}
                            >
                                {picked.size
                                    ? t("skills.editor.importSkills", {count: picked.size})
                                    : t("skills.editor.chooseToImport")}
                            </LoadingButton>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
