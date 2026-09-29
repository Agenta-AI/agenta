/** The Share button and its popover: who can open the app, the link, and stop sharing. */
import {useCallback, useState, type ReactNode} from "react"

import {
    appShareQueryFamily,
    appShareQueryKey,
    editAppShare,
    publishAppShare,
    sharePagePath,
    stopAppShare,
    type AppShareIssue,
    type AppShareResult,
    type ShareVisibility,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {copyToClipboard} from "@agenta/ui"
import {
    Alert,
    Button,
    InlineConfirm,
    Input,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn,
} from "@agenta/ui/ui"
import {Check, Copy, GlobeHemisphereWest, ShareNetwork, UsersThree, X} from "@phosphor-icons/react"
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

const VISIBILITY: Record<ShareVisibility, {label: string; hint: string; icon: ReactNode}> = {
    workspace: {
        label: "Workspace members",
        hint: "People who sign in to this workspace.",
        icon: <UsersThree className="size-4" />,
    },
    link: {
        label: "Anyone with the link",
        hint: "No sign-in needed.",
        icon: <GlobeHemisphereWest className="size-4" />,
    },
}

const describeIssue = (issue: AppShareIssue): string =>
    issue.code === "module_imports_not_captured"
        ? `${issue.path ?? "A module script"} imports other URLs. Those imports do not load in a share.`
        : `${issue.url ?? issue.path ?? "A file"}: ${issue.reason ?? "not captured"}`

const errorText = (error: unknown): string =>
    error instanceof Error ? error.message : "Something went wrong. Try again."

interface ShareTarget {
    mount: Mount
    /** Mount-relative app folder. */
    dir: string
    projectId: string
}

const VisibilityOption = ({
    value,
    selected,
    disabled,
    onSelect,
}: {
    value: ShareVisibility
    selected: boolean
    disabled: boolean
    onSelect: (value: ShareVisibility) => void
}) => (
    <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => onSelect(value)}
        className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-lg border border-solid bg-colorBgContainer p-3 text-left transition-colors disabled:cursor-not-allowed",
            selected
                ? "border-colorText bg-colorFillQuaternary"
                : "border-colorBorderSecondary hover:border-colorBorder",
        )}
    >
        <span
            className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md",
                selected ? "bg-colorText text-colorBgContainer" : "bg-colorFillSecondary text-colorTextSecondary",
            )}
        >
            {VISIBILITY[value].icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-colorText">{VISIBILITY[value].label}</span>
            <span className="text-xs text-colorTextTertiary">{VISIBILITY[value].hint}</span>
        </span>
        <span
            aria-hidden
            className={cn(
                "size-4 shrink-0 rounded-full border border-solid",
                selected ? "border-[5px] border-colorText" : "border-colorBorder",
            )}
        />
    </button>
)

const SharePanel = ({
    target,
    appName,
    result,
    loading,
    onClose,
}: {
    target: ShareTarget
    appName: string
    result: AppShareResult | undefined
    loading: boolean
    onClose: () => void
}) => {
    const {mount, dir, projectId} = target
    const share = result?.share ?? null
    const live = share?.enabled ? share : null

    const [draft, setDraft] = useState<ShareVisibility>("workspace")
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [issues, setIssues] = useState<AppShareIssue[]>([])
    const [copied, setCopied] = useState(false)
    const [confirmStop, setConfirmStop] = useState(false)

    const call = {projectId, mountId: mount.id, path: dir}
    const run = useCallback(
        async (label: string, action: () => Promise<AppShareResult>) => {
            setBusy(label)
            setError(null)
            try {
                const next = await action()
                getHostQueryClient().setQueryData(appShareQueryKey(projectId, mount.id, dir), next)
                setIssues([...(next.external_failed ?? []), ...(next.warnings ?? [])])
            } catch (e) {
                setError(errorText(e))
            } finally {
                setBusy(null)
            }
        },
        [projectId, mount.id, dir],
    )

    const visibility = live?.visibility ?? draft
    const choose = (next: ShareVisibility) => {
        if (!live) setDraft(next)
        else if (next !== live.visibility) void run("visibility", () => editAppShare({...call, visibility: next}))
    }
    const publish = () =>
        run("publish", () => publishAppShare({...call, visibility: live ? undefined : draft}))
    const stop = () => {
        setConfirmStop(false)
        void run("stop", () => stopAppShare(call))
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
        <div className="flex flex-col text-xs">
            <div className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <h2 className="m-0 truncate text-base font-semibold text-colorText">
                            Share {appName}
                        </h2>
                        <p className="m-0 text-sm text-colorTextSecondary">
                            People get a read-only snapshot of the app and its data.
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close"
                        onClick={onClose}
                        className="-mr-1 -mt-1 shrink-0"
                    >
                        <X className="size-4" />
                    </Button>
                </div>

                {loading ? (
                    <div className="h-40 rounded-lg bg-colorFillQuaternary" aria-busy />
                ) : (
                    <>
                        <section role="radiogroup" aria-label="Who can open it" className="flex flex-col gap-2">
                            <span className="text-sm font-semibold text-colorText">Who can open it</span>
                            {(Object.keys(VISIBILITY) as ShareVisibility[]).map((value) => (
                                <VisibilityOption
                                    key={value}
                                    value={value}
                                    selected={visibility === value}
                                    disabled={busy !== null}
                                    onSelect={choose}
                                />
                            ))}
                        </section>

                        {link ? (
                            <div className="flex items-center gap-2">
                                <Input
                                    readOnly
                                    value={link}
                                    aria-label="Share link"
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="h-9 flex-1 text-sm"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={copy}
                                    aria-label={copied ? "Link copied" : "Copy link"}
                                    title={copied ? "Copied" : "Copy link"}
                                    className="size-9 shrink-0"
                                >
                                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                                </Button>
                            </div>
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
                    </>
                )}
            </div>

            <div className="border-0 border-t border-solid border-colorBorderSecondary px-5 py-3">
                {confirmStop ? (
                    <InlineConfirm
                        message="The link stops working now. Sharing again makes a new link."
                        confirmLabel="Stop sharing"
                        onConfirm={stop}
                        onCancel={() => setConfirmStop(false)}
                    />
                ) : (
                    <div className="flex items-center gap-2">
                        {live ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="-ml-2 text-colorError hover:text-colorError"
                                disabled={busy !== null}
                                onClick={() => setConfirmStop(true)}
                            >
                                Stop sharing
                            </Button>
                        ) : null}
                        <span className="flex-1" />
                        <LoadingButton
                            size="sm"
                            variant={live ? "outline" : "default"}
                            loading={busy === "publish"}
                            disabled={loading || busy !== null}
                            onClick={() => void publish()}
                        >
                            {live ? "Update share" : share ? "Share again" : "Share"}
                        </LoadingButton>
                    </div>
                )}
            </div>
        </div>
    )
}

const TRIGGER: Record<"off" | ShareVisibility, {label: string; icon: ReactNode}> = {
    off: {label: "Share", icon: <ShareNetwork className="size-3.5" />},
    workspace: {label: "Workspace", icon: <UsersThree className="size-3.5" />},
    link: {label: "Public", icon: <GlobeHemisphereWest className="size-3.5" />},
}

export interface ShareAppButtonProps {
    mount: Mount | null
    /** Mount-relative app folder. */
    dir: string
    /** The caller may edit this drive (EDIT_MOUNTS). The server checks it again. */
    canEdit: boolean
    /** Known app name (the share page); otherwise read from the folder's `app.json`. */
    appName?: string
    /** The drive's project; default the project in scope (a share link's page has none). */
    projectId?: string
    className?: string
}

/** The Share button: shown only where sharing can work, labelled with the share's state. */
export function ShareAppButton({
    mount,
    dir,
    canEdit,
    appName,
    projectId: projectIdProp,
    className,
}: ShareAppButtonProps) {
    const [open, setOpen] = useState(false)
    const scopedProjectId = useAtomValue(projectIdAtom) ?? ""
    const projectId = projectIdProp ?? scopedProjectId
    const eligible = canEdit && dir !== "" && isShareableMount(mount) && Boolean(projectId)
    const io = useMountAssembleIo(eligible && !appName ? (mount?.id ?? null) : null, projectId || null)
    const {manifest} = useAppManifest(io, dir)
    const name = appName ?? manifest?.name
    const query = useAtomValue(
        appShareQueryFamily({projectId: eligible ? projectId : "", mountId: mount?.id ?? "", path: dir}),
    )

    if (!eligible || !name || !mount) return null
    const share = query.data?.share
    const state = share?.enabled ? share.visibility : "off"

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Share ${name}`}
                    className={cn("h-7 gap-1.5 px-2.5 text-xs", className)}
                >
                    {TRIGGER[state].icon}
                    {TRIGGER[state].label}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[380px] max-w-[calc(100vw-32px)] p-0">
                <SharePanel
                    target={{mount, dir, projectId}}
                    appName={name}
                    result={query.data}
                    loading={query.isPending}
                    onClose={() => setOpen(false)}
                />
            </PopoverContent>
        </Popover>
    )
}
