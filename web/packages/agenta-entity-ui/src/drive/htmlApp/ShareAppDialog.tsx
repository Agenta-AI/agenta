/**
 * Sharing an app from a session drive: the Share button and the owner's dialog.
 *
 * Only a person with edit access, in the browser, can change a share (the server checks the same
 * two things). The dialog shows the link, who can open it, the versions with Restore, and Stop
 * sharing. "Update share" publishes the app's current files as the next version.
 */
import {useCallback, useState} from "react"

import {
    appShareQueryFamily,
    appShareQueryKey,
    editAppShare,
    publishAppShare,
    restoreAppShare,
    sharePagePath,
    stopAppShare,
    type AppShareIssue,
    type AppShareResult,
    type ShareError,
    type ShareVisibility,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {copyToClipboard} from "@agenta/ui"
import {
    Alert,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    InlineConfirm,
    Input,
    LoadingButton,
    RadioGroup,
    RadioGroupItem,
} from "@agenta/ui/ui"
import {Copy, ShareNetwork} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useMountAssembleIo} from "./mountIo"
import {useAppManifest} from "./useAppManifest"

/** A session's working drive: the only place an app can be shared from. */
export const isShareableMount = (mount: Mount | null | undefined): mount is Mount =>
    Boolean(mount?.session_id && mount.name === "cwd")

/** The full link for a share token. The app is served under `/m`. */
export const shareUrl = (token: string): string =>
    typeof window === "undefined"
        ? `/m${sharePagePath(token)}`
        : new URL(`/m${sharePagePath(token)}`, window.location.origin).toString()

const VISIBILITY: Record<ShareVisibility, {label: string; hint: string}> = {
    workspace: {label: "Workspace members", hint: "People who sign in to this workspace."},
    link: {label: "Anyone with the link", hint: "No sign-in needed."},
}

const describeIssue = (issue: AppShareIssue): string =>
    issue.code === "module_imports_not_captured"
        ? `${issue.path ?? "A module script"} imports other URLs. Those imports do not load in a share.`
        : `${issue.url ?? issue.path ?? "A file"}: ${issue.reason ?? "not captured"}`

const errorText = (error: unknown): string =>
    error instanceof Error ? error.message : "Something went wrong. Try again."

export interface ShareAppDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    mount: Mount
    /** Mount-relative app folder. */
    dir: string
    appName: string
    /** The drive's project; default the project in scope (a shared link's page has none). */
    projectId?: string
}

export function ShareAppDialog({
    open,
    onOpenChange,
    mount,
    dir,
    appName,
    projectId: projectIdProp,
}: ShareAppDialogProps) {
    const scopedProjectId = useAtomValue(projectIdAtom) ?? ""
    const projectId = projectIdProp ?? scopedProjectId
    const target = {projectId, mountId: mount.id, path: dir}
    const query = useAtomValue(appShareQueryFamily(target))
    const share = query.data?.share ?? null
    const live = share?.enabled ? share : null

    const [visibility, setVisibility] = useState<ShareVisibility>("workspace")
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [issues, setIssues] = useState<AppShareIssue[]>([])
    const [copied, setCopied] = useState(false)
    const [confirmStop, setConfirmStop] = useState(false)

    const run = useCallback(
        async (label: string, action: () => Promise<AppShareResult>) => {
            setBusy(label)
            setError(null)
            try {
                const result = await action()
                getHostQueryClient().setQueryData(
                    appShareQueryKey(projectId, mount.id, dir),
                    result,
                )
                setIssues([...(result.external_failed ?? []), ...(result.warnings ?? [])])
            } catch (e) {
                setError(errorText(e as ShareError))
            } finally {
                setBusy(null)
            }
        },
        [projectId, mount.id, dir],
    )

    const publish = () =>
        run("publish", () =>
            publishAppShare({...target, visibility: live ? undefined : visibility}),
        )
    const changeVisibility = (next: ShareVisibility) =>
        run("visibility", () => editAppShare({...target, visibility: next}))
    const restore = (version: number) =>
        run(`restore-${version}`, () => restoreAppShare({...target, version}))
    const stop = () => {
        setConfirmStop(false)
        void run("stop", () => stopAppShare(target))
    }

    const link = live?.token ? shareUrl(live.token) : null
    const copy = () => {
        if (!link) return
        void copyToClipboard(link).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md gap-4 text-xs">
                <DialogHeader className="gap-1">
                    <DialogTitle className="text-sm">Share {appName}</DialogTitle>
                    <DialogDescription className="text-xs text-colorTextSecondary">
                        People see a frozen copy of the app, with its data files. They cannot
                        change it. Deleting the session ends the share; archiving it pauses the
                        share.
                    </DialogDescription>
                </DialogHeader>

                {query.isPending ? (
                    <div className="text-colorTextSecondary">Loading…</div>
                ) : (
                    <>
                        <section aria-label="Who can open it" className="flex flex-col gap-2">
                            <span className="font-medium text-colorText">Who can open it</span>
                            <RadioGroup
                                value={live?.visibility ?? visibility}
                                onValueChange={(v) =>
                                    live
                                        ? void changeVisibility(v as ShareVisibility)
                                        : setVisibility(v as ShareVisibility)
                                }
                                className="flex flex-col gap-2"
                                disabled={busy !== null}
                            >
                                {(Object.keys(VISIBILITY) as ShareVisibility[]).map((key) => (
                                    <label key={key} className="flex cursor-pointer items-start gap-2">
                                        <RadioGroupItem value={key} className="mt-0.5" />
                                        <span className="flex flex-col">
                                            <span className="text-colorText">
                                                {VISIBILITY[key].label}
                                            </span>
                                            <span className="text-colorTextTertiary">
                                                {VISIBILITY[key].hint}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </RadioGroup>
                        </section>

                        {link ? (
                            <section aria-label="Link" className="flex items-center gap-2">
                                <Input
                                    readOnly
                                    value={link}
                                    aria-label="Share link"
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="h-8 flex-1 text-xs"
                                />
                                <Button variant="outline" size="sm" onClick={copy} className="h-8 gap-1">
                                    <Copy className="size-3.5" />
                                    {copied ? "Copied" : "Copy link"}
                                </Button>
                            </section>
                        ) : null}

                        {error ? <Alert type="error" showIcon message={error} /> : null}
                        {issues.length > 0 ? (
                            <Alert
                                type="warning"
                                showIcon
                                message="Some files are not in the share"
                                description={
                                    <ul className="m-0 list-disc pl-4">
                                        {issues.map((issue, i) => (
                                            <li key={i} className="break-words">
                                                {describeIssue(issue)}
                                            </li>
                                        ))}
                                    </ul>
                                }
                            />
                        ) : null}

                        {share && share.versions.length > 0 ? (
                            <section aria-label="Versions" className="flex flex-col gap-1">
                                <span className="font-medium text-colorText">Versions</span>
                                <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-auto p-0">
                                    {[...share.versions].reverse().map((v) => (
                                        <li key={v.version} className="flex items-center gap-2">
                                            <span className="text-colorText">v{v.version}</span>
                                            <span className="text-colorTextTertiary">
                                                {new Date(v.created_at).toLocaleString()}
                                                {v.restored_from
                                                    ? ` · restored from v${v.restored_from}`
                                                    : ""}
                                            </span>
                                            <span className="flex-1" />
                                            {v.version === share.latest ? (
                                                <span className="text-colorTextTertiary">Live</span>
                                            ) : (
                                                <>
                                                    {live?.token ? (
                                                        <a
                                                            href={`${shareUrl(live.token)}?v=${v.version}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-colorLink"
                                                        >
                                                            Open
                                                        </a>
                                                    ) : null}
                                                    <LoadingButton
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-1.5 text-xs"
                                                        loading={busy === `restore-${v.version}`}
                                                        disabled={busy !== null}
                                                        onClick={() => void restore(v.version)}
                                                    >
                                                        Restore
                                                    </LoadingButton>
                                                </>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}

                        {confirmStop ? (
                            <InlineConfirm
                                message="The link stops working now. Sharing again makes a new link."
                                confirmLabel="Stop sharing"
                                onConfirm={stop}
                                onCancel={() => setConfirmStop(false)}
                            />
                        ) : (
                            <div className="flex items-center justify-end gap-2">
                                {live ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-colorError"
                                        disabled={busy !== null}
                                        onClick={() => setConfirmStop(true)}
                                    >
                                        Stop sharing
                                    </Button>
                                ) : null}
                                <LoadingButton
                                    size="sm"
                                    loading={busy === "publish"}
                                    disabled={busy !== null}
                                    onClick={() => void publish()}
                                >
                                    {live ? "Update share" : share ? "Share again" : "Share"}
                                </LoadingButton>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

export interface ShareAppButtonProps {
    mount: Mount | null
    /** Mount-relative app folder. */
    dir: string
    /** The caller may edit this drive (EDIT_MOUNTS). The server checks it again. */
    canEdit: boolean
}

/** The Share button, shown only where sharing can work: an app folder in a session drive. */
export function ShareAppButton({mount, dir, canEdit}: ShareAppButtonProps) {
    const [open, setOpen] = useState(false)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const eligible = canEdit && dir !== "" && isShareableMount(mount)
    const io = useMountAssembleIo(eligible ? (mount?.id ?? null) : null, projectId || null)
    const {manifest} = useAppManifest(io, dir)

    if (!eligible || !manifest || !mount) return null
    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(true)}
                aria-label={`Share ${manifest.name}`}
                className="h-7 gap-1 px-2 text-xs"
            >
                <ShareNetwork className="size-3.5" />
                Share
            </Button>
            {open ? (
                <ShareAppDialog
                    open={open}
                    onOpenChange={setOpen}
                    mount={mount}
                    dir={dir}
                    appName={manifest.name}
                />
            ) : null}
        </>
    )
}
