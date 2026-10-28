import {useId, useState} from "react"

import ChatMarkdown from "@agenta/chat/markdown"
import {
    ALL_RELEASES_LINK,
    isWhatsNewOptedOut,
    markAllReleasesSeen,
    RELEASES,
    setWhatsNewOptedOut,
    type Release,
} from "@agenta/navigation"
import {Button, Checkbox, Dialog, DialogClose, DialogContent, DialogTitle} from "@agenta/ui/ui"
import {ArrowUpRight, Sparkle, Wrench, X} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {cn} from "@/lib/utils"

import {markdownIcons, proseClassName} from "../chat/AssistantMarkdown"

import {ReleaseFeatureVideo} from "./ReleaseFeatureVideo"
import {ReleaseItemsSection} from "./ReleaseItemsSection"
import {whatsNewAtom} from "./whatsNewAtom"

/** The rail lists this many releases, newest first; the rest are one link away. */
const RAIL_COUNT = 6

const formatReleaseDate = (release: Release): string => {
    const [year, month, day] = release.date.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    })
}

const RAIL_RELEASES = RELEASES.slice(0, RAIL_COUNT)

/** Release timeline rail beside the picked release; closing it in any way marks everything seen. */
export const WhatsNewDialog = () => {
    const [state, setState] = useAtom(whatsNewAtom)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [playingId, setPlayingId] = useState<string | null>(null)
    // Null until touched, so each opening starts from the stored choice.
    const [optOutDraft, setOptOutDraft] = useState<boolean | null>(null)
    const optOut = optOutDraft ?? isWhatsNewOptedOut()
    const optOutId = useId()

    const selected =
        RELEASES.find((release) => release.id === (selectedId ?? state?.releaseId)) ??
        RAIL_RELEASES[0]
    if (!selected) return null

    const close = () => {
        setWhatsNewOptedOut(optOut)
        markAllReleasesSeen()
        setOptOutDraft(null)
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
                className="gap-0 rounded-2xl p-0 shadow-dialog max-md:max-h-[85dvh] md:grid md:h-[min(720px,85dvh)] md:max-w-[1040px] md:grid-cols-[272px_1fr] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden"
            >
                <div className="flex flex-col border-0 border-solid border-colorBorderSecondary bg-muted px-3 pb-3 pt-5 max-md:border-t md:min-h-0 md:overflow-y-auto md:border-r">
                    <div className="flex flex-col gap-1 px-2 pb-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                            What&apos;s new
                        </span>
                        <DialogTitle className="m-0 text-[18px] font-medium tracking-[-0.015em] text-foreground">
                            Latest releases
                        </DialogTitle>
                    </div>

                    <div className="flex flex-col">
                        <div className="flex flex-col gap-2">
                            {RAIL_RELEASES.map((release, index) => {
                                const active = release.id === selected.id
                                return (
                                    <button
                                        key={release.id}
                                        type="button"
                                        onClick={() => select(release.id)}
                                        className="group relative grid cursor-pointer grid-cols-[15px_1fr] items-start gap-1.5 border-0 bg-transparent p-0 text-left"
                                    >
                                        <span aria-hidden className="relative self-stretch">
                                            {/* One segment per row, so the thread fits any row height. */}
                                            <span
                                                className={cn(
                                                    "absolute left-1/2 w-px -translate-x-1/2 bg-border",
                                                    index === 0 ? "top-[17px]" : "top-0",
                                                    index === RAIL_RELEASES.length - 1
                                                        ? "h-[17px]"
                                                        : "-bottom-2",
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    "absolute left-1/2 top-[14px] size-[7px] -translate-x-1/2 rounded-full ring-[3px] ring-muted transition-colors",
                                                    active
                                                        ? "bg-foreground"
                                                        : "bg-colorTextQuaternary group-hover:bg-colorTextTertiary",
                                                )}
                                            />
                                        </span>
                                        <span
                                            className={cn(
                                                "flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-colors",
                                                active
                                                    ? "bg-background"
                                                    : "group-hover:bg-background/60",
                                            )}
                                        >
                                            <span className="flex items-center justify-between gap-2 text-[11.5px] text-colorTextTertiary">
                                                <span className="flex items-center gap-1.5">
                                                    {release.id}
                                                    {index === 0 ? (
                                                        <span className="rounded bg-colorSuccessBg px-1.5 text-[10.5px] font-medium leading-4 text-colorSuccessText">
                                                            Latest
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span>{formatReleaseDate(release)}</span>
                                            </span>
                                            <span className="truncate text-[13.5px] leading-5 text-foreground">
                                                {release.features[0]?.title}
                                            </span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <a
                        href={ALL_RELEASES_LINK}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto flex items-center gap-1 px-2 pt-4 text-[13px] text-muted-foreground no-underline hover:text-foreground"
                    >
                        View all releases
                        <ArrowUpRight size={11} aria-hidden />
                    </a>
                </div>

                <div className="relative order-first flex min-w-0 flex-col md:order-none md:min-h-0">
                    <DialogClose asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Close"
                            className="absolute right-2 top-2 z-10 bg-background/80 text-muted-foreground backdrop-blur-sm hover:bg-background md:right-3 md:top-3"
                        >
                            <X />
                        </Button>
                    </DialogClose>

                    <div
                        // Keyed so a newly picked release opens scrolled to the top.
                        key={selected.id}
                        className="flex flex-col gap-8 px-4 pb-6 pt-12 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-6 md:pt-6"
                    >
                        {selected.features.map((feature) => (
                            <section key={feature.id} className="flex flex-col gap-3">
                                {feature.streamVideoId ? (
                                    <ReleaseFeatureVideo
                                        feature={feature}
                                        videoId={feature.streamVideoId}
                                        playing={playingId === feature.id}
                                        onPlay={() => setPlayingId(feature.id)}
                                    />
                                ) : null}
                                <h2 className="m-0 pr-10 text-[17px] font-semibold tracking-[-0.015em] text-foreground md:text-[20px]">
                                    {feature.title}
                                </h2>
                                <ChatMarkdown
                                    baseClassName={proseClassName}
                                    content={feature.body}
                                    icons={markdownIcons}
                                />
                            </section>
                        ))}

                        {selected.improvements.length > 0 || selected.fixes.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                <ReleaseItemsSection
                                    title="Improvements"
                                    icon={Sparkle}
                                    items={selected.improvements}
                                />
                                <ReleaseItemsSection
                                    title="Fixes"
                                    icon={Wrench}
                                    items={selected.fixes}
                                />
                            </div>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-colorBorderSecondary px-4 py-2.5 md:px-6">
                        <label
                            htmlFor={optOutId}
                            className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-[13px] text-muted-foreground"
                        >
                            <Checkbox
                                id={optOutId}
                                checked={optOut}
                                onCheckedChange={(checked) => setOptOutDraft(checked === true)}
                            />
                            Don&apos;t show this again
                        </label>
                        <Button
                            asChild
                            variant="ghost"
                            className="rounded-[10px] px-3 text-[13.5px] font-normal hover:bg-muted"
                        >
                            <a
                                href={selected.features[0]?.link ?? ALL_RELEASES_LINK}
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
