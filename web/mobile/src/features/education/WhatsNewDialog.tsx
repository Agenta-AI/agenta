import {useMemo, useState} from "react"

import {
    ALL_RELEASES_LINK,
    getUnseenReleases,
    markAllReleasesSeen,
    RELEASES,
    type ReleaseEntry,
} from "@agenta/navigation"
import {Button, Dialog, DialogContent, DialogTitle} from "@agenta/ui/ui"
import {ArrowUpRight, Package, Play, Sparkle} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {useMobileVersion} from "../nav/useMobileNavItems"

import {streamPlayerUrl, streamThumbnailUrl} from "./streamMedia"
import {whatsNewAtom} from "./whatsNewAtom"

import {cn} from "@/lib/utils"

/** The rail lists this many releases, newest first; the rest are one link away. */
const RAIL_COUNT = 4

/** Release clips open on a black frame, so the still is taken a moment in. */
const STILL_SECONDS = 2

/** The ship date from the documented id convention `changelog-YYYY-MM-DD-slug`. */
const releaseDate = (release: ReleaseEntry): Date | null => {
    const match = /^changelog-(\d{4})-(\d{2})-(\d{2})-/.exec(release.id)
    return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null
}

const formatReleaseDate = (release: ReleaseEntry): string =>
    releaseDate(release)?.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }) ?? ""

const NEWEST_RELEASES = [...RELEASES]
    .sort((a, b) => (releaseDate(b)?.getTime() ?? 0) - (releaseDate(a)?.getTime() ?? 0))
    .slice(0, RAIL_COUNT)

/** Release timeline rail beside the picked release; closing it in any way marks everything seen. */
export const WhatsNewDialog = () => {
    const [state, setState] = useAtom(whatsNewAtom)
    const version = useMobileVersion()
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [playingId, setPlayingId] = useState<string | null>(null)
    // Counted once per opening, before closing marks everything seen.
    const newCount = useMemo(() => {
        if (!state) return 0
        const unseen = new Set(getUnseenReleases().map((release) => release.id))
        return NEWEST_RELEASES.filter((release) => unseen.has(release.id)).length
    }, [state])

    const selected =
        NEWEST_RELEASES.find((release) => release.id === (selectedId ?? state?.releaseId)) ??
        NEWEST_RELEASES[0]
    if (!selected) return null
    const playing = playingId === selected.id

    const close = () => {
        markAllReleasesSeen()
        setState(null)
        setSelectedId(null)
        setPlayingId(null)
    }
    const select = (id: string) => {
        setSelectedId(id)
        setPlayingId(null)
    }

    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent
                showCloseButton={false}
                aria-describedby={undefined}
                className="gap-0 rounded-2xl p-0 shadow-dialog md:grid md:h-[540px] md:max-w-[920px] md:grid-cols-[272px_1fr] md:overflow-hidden"
            >
                <div className="flex flex-col border-0 border-solid border-colorBorderSecondary bg-muted px-4 pb-3.5 pt-6 md:border-r">
                    <div className="flex flex-col gap-1 px-2 pb-4">
                        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            What&apos;s new
                        </span>
                        <div className="flex items-center justify-between gap-2">
                            <DialogTitle className="m-0 text-[18px] font-semibold tracking-[-0.015em] text-foreground">
                                Latest releases
                            </DialogTitle>
                            {newCount > 0 ? (
                                <span className="inline-flex h-5 items-center rounded-full bg-hero-action px-[7px] text-[11.5px] font-semibold text-hero-action-foreground">
                                    {newCount} new
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex flex-col">
                        {NEWEST_RELEASES.map((release, index) => {
                            const active = release.id === selected.id
                            return (
                                <button
                                    key={release.id}
                                    type="button"
                                    onClick={() => select(release.id)}
                                    className="group grid cursor-pointer grid-cols-[20px_1fr] gap-2 border-0 bg-transparent p-0 text-left"
                                >
                                    <span className="relative">
                                        <span
                                            className={cn(
                                                "absolute bottom-0 left-1/2 w-px -translate-x-1/2 bg-border",
                                                index === 0 ? "top-[21px]" : "top-0",
                                            )}
                                        />
                                        <span
                                            className={cn(
                                                "absolute left-1/2 top-[17px] box-border size-[9px] -translate-x-1/2 rounded-full border-[1.5px] border-solid",
                                                active
                                                    ? "border-foreground bg-foreground shadow-[0_0_0_3px_var(--hero-action-bg)]"
                                                    : "border-colorTextQuaternary bg-muted shadow-[0_0_0_3px_var(--muted)]",
                                            )}
                                        />
                                    </span>
                                    <span
                                        className={cn(
                                            "my-0.5 flex min-w-0 flex-col gap-[3px] rounded-[10px] border border-solid px-3 py-2.5 transition-colors",
                                            active
                                                ? "border-colorBorderSecondary bg-background shadow-[var(--ag-surface-card-shadow)]"
                                                : "border-transparent group-hover:bg-background",
                                        )}
                                    >
                                        <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-colorTextTertiary">
                                            {formatReleaseDate(release)}
                                        </span>
                                        <span
                                            className={cn(
                                                "text-[13.5px] leading-[1.35] text-foreground",
                                                active ? "font-semibold" : "font-medium",
                                            )}
                                        >
                                            {release.title}
                                        </span>
                                    </span>
                                </button>
                            )
                        })}
                        <a
                            href={ALL_RELEASES_LINK}
                            target="_blank"
                            rel="noreferrer"
                            className="grid grid-cols-[20px_1fr] gap-2 text-muted-foreground no-underline hover:text-foreground"
                        >
                            <span className="relative h-10">
                                <span className="absolute left-1/2 top-0 h-[11px] w-px -translate-x-1/2 bg-border" />
                                <Package
                                    size={14}
                                    aria-hidden
                                    className="absolute left-1/2 top-[13px] -translate-x-1/2"
                                />
                            </span>
                            <span className="flex items-center gap-1 px-3 text-[13px]">
                                View all releases
                                <ArrowUpRight size={11} aria-hidden />
                            </span>
                        </a>
                    </div>

                    {version ? (
                        <span className="mt-auto px-2 pt-4 text-[11px] text-colorTextTertiary">
                            Running v{version}
                        </span>
                    ) : null}
                </div>

                <div className="flex min-w-0 flex-col px-7 py-6">
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-solid border-colorBorderSecondary">
                        {selected.streamVideoId && playing ? (
                            <iframe
                                // Keyed so a new release swaps the player rather than navigating it.
                                key={selected.streamVideoId}
                                src={streamPlayerUrl(selected.streamVideoId)}
                                title={selected.title}
                                className="block size-full border-0 bg-black"
                                allow="autoplay; fullscreen; picture-in-picture"
                            />
                        ) : selected.streamVideoId ? (
                            <button
                                type="button"
                                onClick={() => setPlayingId(selected.id)}
                                aria-label={`Play ${selected.title}`}
                                className="block size-full cursor-pointer border-0 bg-black p-0"
                            >
                                <img
                                    src={streamThumbnailUrl(selected.streamVideoId, STILL_SECONDS)}
                                    alt=""
                                    className="block size-full object-cover"
                                />
                                <span className="absolute bottom-4 left-4 inline-flex h-[34px] items-center gap-2 rounded-full bg-background pl-[5px] pr-[13px] text-[13px] font-medium text-foreground shadow-overlay">
                                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-hero-action text-hero-action-foreground">
                                        <Play size={11} weight="fill" aria-hidden />
                                    </span>
                                    Play
                                </span>
                            </button>
                        ) : (
                            <div className="flex size-full flex-col items-center justify-center gap-3.5 bg-muted bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[size:16px_16px]">
                                <span className="inline-flex size-16 items-center justify-center rounded-2xl border border-solid border-colorBorderSecondary bg-background text-foreground shadow-[var(--ag-surface-card-shadow)]">
                                    <Sparkle size={28} aria-hidden />
                                </span>
                                <span className="text-[17px] font-semibold text-foreground">
                                    {selected.title}
                                </span>
                                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-colorTextTertiary">
                                    {formatReleaseDate(selected)}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="mt-5 flex flex-col gap-1.5">
                        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.015em] text-foreground">
                            {selected.title}
                        </h2>
                        <p className="m-0 max-w-[56ch] text-[14px] leading-[1.55] text-muted-foreground">
                            {selected.description}
                        </p>
                    </div>

                    <div className="-mb-3 mt-auto flex justify-end pt-4">
                        <Button
                            asChild
                            variant="ghost"
                            className="rounded-[10px] px-3 text-[13.5px] font-normal hover:bg-muted"
                        >
                            <a
                                href={selected.link ?? ALL_RELEASES_LINK}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Read changelog
                                <ArrowUpRight className="size-3" aria-hidden />
                            </a>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
