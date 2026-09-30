import {useState} from "react"

import {
    getUnseenReleases,
    markAllReleasesSeen,
    RELEASES,
    type ReleaseEntry,
} from "@agenta/navigation"
import {Badge, Button, Dialog, DialogContent, DialogTitle} from "@agenta/ui/ui"
import {ArrowSquareOut, Sparkle} from "@phosphor-icons/react"

/** Alongside the new entries, the modal recaps this many already-seen releases. */
const RECENT_SEEN_COUNT = 2

/** The Stream account the docs embeds use — release clips live on the same one. */
const STREAM_CUSTOMER = "customer-8r37tdgzpxskd9f1"

interface WhatsNewItem extends ReleaseEntry {
    isNew: boolean
}

/**
 * The what's-new PUSH surface: a Notion-style modal shown on entering Home, only when
 * something shipped since this browser last looked. Left, the stack of new releases plus
 * the last two older ones for context; right, the selected release's demo clip (muted,
 * looping, like the docs embeds) or its description when there is none.
 *
 * The gating lives in `getUnseenReleases`: a first visit seeds everything as seen and the
 * 7-day quiet period holds the modal off for new users, so it can never greet a signup.
 * Closing it in ANY way marks everything seen — a modal that reopened on the next visit
 * would read as a bug. The full history stays under Help & Docs → "What's new?".
 */
export const WhatsNewDialog = () => {
    const [items] = useState<WhatsNewItem[]>(() => {
        const unseen = getUnseenReleases()
        if (unseen.length === 0) return []
        const unseenIds = new Set(unseen.map((release) => release.id))
        const recentSeen = RELEASES.filter((release) => !unseenIds.has(release.id)).slice(
            0,
            RECENT_SEEN_COUNT,
        )
        return [
            ...unseen.map((release) => ({...release, isNew: true})),
            ...recentSeen.map((release) => ({...release, isNew: false})),
        ]
    })
    const [open, setOpen] = useState(() => items.length > 0)
    const [selectedId, setSelectedId] = useState<string | null>(() => items[0]?.id ?? null)

    if (items.length === 0) return null
    const selected = items.find((item) => item.id === selectedId) ?? items[0]

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    markAllReleasesSeen()
                    setOpen(false)
                }
            }}
        >
            <DialogContent className="gap-0 overflow-hidden p-0 md:max-h-[560px] md:max-w-[880px] md:flex-row">
                {/* Left: the release stack. */}
                <div className="flex w-full flex-col md:w-[300px] md:shrink-0 md:border-r md:border-border">
                    <div className="flex items-center gap-2 px-4 pb-2 pt-4">
                        <Sparkle size={15} aria-hidden className="text-muted-foreground" />
                        <DialogTitle className="m-0 text-[14px] font-semibold">
                            What&apos;s new in Agenta
                        </DialogTitle>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-1">
                        {items.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedId(item.id)}
                                className={`rounded-[9px] px-2.5 py-2 text-left transition-colors ${
                                    item.id === selected.id ? "bg-muted" : "hover:bg-muted/50"
                                }`}
                            >
                                <span className="flex items-center gap-1.5">
                                    <span className="truncate text-[13px] font-medium text-foreground">
                                        {item.title}
                                    </span>
                                    {item.isNew ? (
                                        <Badge className="h-4 shrink-0 px-1.5 text-[10px]">
                                            New
                                        </Badge>
                                    ) : null}
                                </span>
                                <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">
                                    {item.description}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="border-t border-border px-4 py-2.5">
                        <a
                            href="https://agenta.ai/docs/changelog"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground no-underline hover:text-foreground"
                        >
                            View all releases
                            <ArrowSquareOut size={12} aria-hidden />
                        </a>
                    </div>
                </div>

                {/* Right: the selected release's attachment — its demo clip, or the text
                    when no clip exists. Hidden on a phone, where the stack alone carries it. */}
                <div className="hidden min-h-[420px] flex-1 flex-col bg-muted/40 p-5 md:flex">
                    {selected.streamVideoId ? (
                        <div className="aspect-video w-full overflow-hidden rounded-[10px] bg-muted">
                            <iframe
                                // Keyed so switching entries swaps the player instead of
                                // navigating inside one iframe.
                                key={selected.streamVideoId}
                                src={`https://${STREAM_CUSTOMER}.cloudflarestream.com/${selected.streamVideoId}/iframe?muted=true&loop=true&autoplay=true`}
                                title={selected.title}
                                className="size-full border-0"
                                allow="autoplay; fullscreen; picture-in-picture"
                            />
                        </div>
                    ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-[10px] bg-muted px-8 text-center">
                            <p className="m-0 text-[13px] leading-snug text-muted-foreground">
                                {selected.description}
                            </p>
                        </div>
                    )}
                    <div className="mt-4 min-w-0">
                        <p className="m-0 truncate text-[15px] font-semibold text-foreground">
                            {selected.title}
                        </p>
                        <p className="m-0 mt-1 text-[13px] leading-snug text-muted-foreground">
                            {selected.description}
                        </p>
                        {selected.link ? (
                            <Button asChild variant="outline" size="sm" className="mt-3">
                                <a href={selected.link} target="_blank" rel="noreferrer">
                                    Read more
                                    <ArrowSquareOut size={13} aria-hidden />
                                </a>
                            </Button>
                        ) : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
