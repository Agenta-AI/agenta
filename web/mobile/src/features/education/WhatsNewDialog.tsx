import {useId, useState} from "react"

import ChatMarkdown from "@agenta/chat/markdown"
import {formatLocale, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import whatsNewCatalog from "@agenta/i18n/catalogs/education.whatsNew"
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

import {FadingScrollBody} from "./FadingScrollBody"
import {ReleaseCover} from "./ReleaseCover"
import {ReleaseFeatureVideo} from "./ReleaseFeatureVideo"
import {ReleaseItemsSection} from "./ReleaseItemsSection"
import {whatsNewAtom} from "./whatsNewAtom"

/** The rail lists this many releases, newest first; the rest are one link away. */
const RAIL_COUNT = 6

const formatReleaseDate = (release: Release): string => {
    const [year, month, day] = release.date.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(formatLocale() ?? "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    })
}

const RAIL_RELEASES = RELEASES.slice(0, RAIL_COUNT)

/** Release timeline rail beside the picked release; closing it in any way marks everything seen. */
export const WhatsNewDialog = () => {
    const t = useT(whatsNewCatalog, commonCatalog)
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
                className="gap-0 rounded-xl p-0 shadow-modal max-md:max-h-[85dvh] md:grid md:h-[min(720px,85dvh)] md:max-w-content-lg md:grid-cols-[272px_1fr] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden"
            >
                <div className="flex flex-col border-0 border-solid border-border-muted bg-muted px-3 pb-3 pt-5 max-md:border-t md:min-h-0 md:overflow-y-auto md:border-r">
                    <div className="flex flex-col gap-1 px-2 pb-3">
                        <span className="text-meta text-muted-foreground">
                            {t("education.whatsNew.kicker")}
                        </span>
                        <DialogTitle className="m-0 text-title text-foreground">
                            {t("education.whatsNew.title")}
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
                                        className="focus-ring group relative grid cursor-pointer grid-cols-[15px_1fr] items-start gap-1.5 rounded-lg border-0 bg-transparent p-0 text-left"
                                    >
                                        <span aria-hidden className="relative self-stretch">
                                            {/* One segment per row, so the thread fits any row height. */}
                                            <span
                                                className={cn(
                                                    "absolute left-1/2 w-px -translate-x-1/2 bg-border",
                                                    index === 0 ? "top-[15px]" : "top-0",
                                                    index === RAIL_RELEASES.length - 1
                                                        ? "h-[15px]"
                                                        : "-bottom-2",
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    "absolute left-1/2 top-[11px] size-2 -translate-x-1/2 rounded-xs ring-[3px] ring-muted transition-colors",
                                                    active
                                                        ? "bg-foreground"
                                                        : "bg-border-strong group-hover:bg-muted-foreground",
                                                )}
                                            />
                                        </span>
                                        <span
                                            className={cn(
                                                // row-double: 48 tall, the two lines centered (ROW-01).
                                                "box-border flex h-row-double min-w-0 flex-col justify-center gap-0.5 rounded-lg px-2 transition-colors",
                                                active
                                                    ? "bg-selected"
                                                    : "group-hover:bg-accent",
                                            )}
                                        >
                                            <span className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
                                                <span className="flex items-center gap-1.5">
                                                    {release.id}
                                                    {index === 0 ? (
                                                        <span className="rounded-sm bg-success/10 px-1.5 text-caption text-success">
                                                            {t("education.whatsNew.latest")}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span>{formatReleaseDate(release)}</span>
                                            </span>
                                            <span className="truncate text-label text-foreground">
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
                        className="mt-auto flex items-center gap-1 px-2 pt-4 text-label text-muted-foreground no-underline hover:text-foreground"
                    >
                        {t("education.whatsNew.viewAll")}
                        <ArrowUpRight size={12} aria-hidden />
                    </a>
                </div>

                <div className="relative order-first flex min-w-0 flex-col md:order-none md:min-h-0">
                    <DialogClose asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.close")}
                            className="absolute right-2 top-2 z-10 bg-background/80 text-muted-foreground backdrop-blur-sm hover:bg-[image:linear-gradient(var(--accent),var(--accent))] md:right-3 md:top-3"
                        >
                            <X />
                        </Button>
                    </DialogClose>

                    <FadingScrollBody
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
                                ) : feature.cover ? (
                                    <ReleaseCover cover={feature.cover} />
                                ) : null}
                                <h2 className="m-0 pr-10 text-heading text-foreground">
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
                                    title={t("education.whatsNew.improvements")}
                                    icon={Sparkle}
                                    items={selected.improvements}
                                />
                                <ReleaseItemsSection
                                    title={t("education.whatsNew.fixes")}
                                    icon={Wrench}
                                    items={selected.fixes}
                                />
                            </div>
                        ) : null}
                    </FadingScrollBody>

                    <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border-muted px-4 py-2 md:px-6">
                        <label
                            htmlFor={optOutId}
                            className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-label text-muted-foreground"
                        >
                            <Checkbox
                                id={optOutId}
                                checked={optOut}
                                onCheckedChange={(checked) => setOptOutDraft(checked === true)}
                            />
                            {t("education.whatsNew.dontShowAgain")}
                        </label>
                        <Button
                            asChild
                            variant="ghost"
                        >
                            <a
                                href={selected.features[0]?.link ?? ALL_RELEASES_LINK}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {t("education.whatsNew.readChangelog")}
                                <ArrowUpRight className="size-3" aria-hidden />
                            </a>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
