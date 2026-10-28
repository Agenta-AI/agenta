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
import {ArrowUpRight, X} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {cn} from "@/lib/utils"

import {markdownIcons, proseClassName} from "../chat/AssistantMarkdown"
import {useMobileVersion} from "../nav/useMobileNavItems"

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
    const version = useMobileVersion()
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
                        {RAIL_RELEASES.map((release, index) => {
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
                                                index === 0 ? "top-[19px]" : "top-0",
                                            )}
                                        />
                                        <span
                                            className={cn(
                                                "absolute left-1/2 top-[15px] box-border size-[9px] -translate-x-1/2 rounded-full border-[1.5px] border-solid",
                                                active
                                                    ? "border-foreground bg-foreground shadow-[0_0_0_3px_var(--hero-action-bg)]"
                                                    : "border-colorTextQuaternary bg-muted shadow-[0_0_0_3px_var(--muted)]",
                                            )}
                                        />
                                    </span>
                                    <span
                                        className={cn(
                                            "my-1 flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-1.5 transition-colors",
                                            active
                                                ? "bg-background"
                                                : "group-hover:bg-background/60",
                                        )}
                                    >
                                        <span className="flex items-baseline gap-2 text-[11px] text-colorTextTertiary">
                                            <span className="font-medium uppercase tracking-[0.06em]">
                                                {formatReleaseDate(release)}
                                            </span>
                                            <span className="font-mono">{release.id}</span>
                                        </span>
                                        <span
                                            className={cn(
                                                "line-clamp-2 text-[13.5px] leading-[1.35] text-foreground",
                                                active ? "font-medium" : "font-normal",
                                            )}
                                        >
                                            {release.features[0]?.title}
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

                <div className="order-first flex min-w-0 flex-col md:order-none md:min-h-0">
                    <div className="flex items-center justify-between gap-3 py-2 pl-4 pr-2 md:pl-6 md:pr-3">
                        <span className="text-[12px] text-muted-foreground">
                            {formatReleaseDate(selected)} ·{" "}
                            <span className="font-mono">{selected.id}</span>
                        </span>
                        <DialogClose asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Close"
                                className="text-muted-foreground"
                            >
                                <X />
                            </Button>
                        </DialogClose>
                    </div>

                    <div
                        // Keyed so a newly picked release opens scrolled to the top.
                        key={selected.id}
                        className="flex flex-col gap-8 px-4 pb-6 pt-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-6"
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
                                <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em] text-foreground md:text-[20px]">
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
                            <div className="flex flex-col border-0 border-b border-solid border-colorBorderSecondary">
                                <ReleaseItemsSection
                                    title="Improvements"
                                    items={selected.improvements}
                                />
                                <ReleaseItemsSection title="Fixes" items={selected.fixes} />
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
