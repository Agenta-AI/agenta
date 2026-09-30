import {useState} from "react"

import {getUnseenReleases, markAllReleasesSeen, type ReleaseEntry} from "@agenta/navigation"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, Sparkle, X} from "@phosphor-icons/react"

/** The push surface shows at most this many entries; the help menu holds the rest. */
const MAX_SHOWN = 3

/**
 * The what's-new PUSH surface: one dismissible card on Home, only when something
 * shipped since this browser last looked.
 *
 * It stays empty for a first visit (everything already shipped is the product, not
 * news) and through the quiet period after it — `getUnseenReleases` owns both rules.
 * Dismissing marks everything seen; the full list stays reachable any time under
 * Help & Docs → "What's new?". Read once at mount: the unseen set only changes with a
 * deploy, and a card that vanished mid-visit would read as a glitch.
 */
export const WhatsNewCard = () => {
    const [unseen, setUnseen] = useState<ReleaseEntry[]>(() => getUnseenReleases())
    if (unseen.length === 0) return null

    const dismiss = () => {
        markAllReleasesSeen()
        setUnseen([])
    }

    return (
        // Its own slim frame on the home column's geometry (620px, centred): the page frame's
        // deep top inset belongs to the hero below, not to a banner above it.
        <div className={`${pageContentWidthClass} px-4 pt-5 lg:px-16 lg:pt-8`}>
            <section
                aria-label="What's new"
                className="mx-auto w-full max-w-[620px] rounded-[12px] border border-border bg-muted/40 px-4 py-3"
            >
                <div className="flex items-center gap-2">
                    <Sparkle size={15} aria-hidden className="text-muted-foreground" />
                    <p className="m-0 flex-1 text-[13px] font-semibold text-foreground">
                        New in Agenta
                    </p>
                    <Button
                        aria-label="Dismiss what's new"
                        variant="ghost"
                        size="sm"
                        className="size-7 px-0"
                        onClick={dismiss}
                    >
                        <X size={14} aria-hidden />
                    </Button>
                </div>
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                    {unseen.slice(0, MAX_SHOWN).map((release) => (
                        <li key={release.id} className="min-w-0">
                            {release.link ? (
                                <a
                                    href={release.link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group block no-underline"
                                >
                                    <span className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-foreground group-hover:underline">
                                        <span className="truncate">{release.title}</span>
                                        <ArrowSquareOut
                                            size={12}
                                            aria-hidden
                                            className="shrink-0 text-muted-foreground"
                                        />
                                    </span>
                                    <span className="block text-[12px] leading-snug text-muted-foreground">
                                        {release.description}
                                    </span>
                                </a>
                            ) : (
                                <>
                                    <span className="block truncate text-[13px] font-medium text-foreground">
                                        {release.title}
                                    </span>
                                    <span className="block text-[12px] leading-snug text-muted-foreground">
                                        {release.description}
                                    </span>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}
