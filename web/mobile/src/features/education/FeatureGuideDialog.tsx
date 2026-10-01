import {Button, Dialog, DialogContent, DialogTitle, Kbd} from "@agenta/ui/ui"
import {BookOpen} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {FEATURE_GUIDES} from "./featureGuides"
import {streamPlayerUrl} from "./streamMedia"

/** The walkthrough lightbox; `GlobalDrawers` mounts it and `openFeatureGuideAtom` opens it. */
export const FeatureGuideDialog = () => {
    const [guideKey, setGuideKey] = useAtom(openFeatureGuideAtom)
    const guide = guideKey ? FEATURE_GUIDES[guideKey] : null
    const video = guide?.video

    return (
        <Dialog open={Boolean(video)} onOpenChange={(open) => !open && setGuideKey(null)}>
            {guide && video ? (
                <DialogContent
                    showCloseButton={false}
                    aria-describedby={undefined}
                    overlayClassName="bg-black/40"
                    // Focus in the cross-origin player would swallow Esc.
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        ;(event.currentTarget as HTMLElement).focus()
                    }}
                    className="max-w-[1000px] gap-0 overflow-hidden rounded-[24px] p-3 shadow-dialog"
                >
                    <div className="aspect-video w-full overflow-hidden rounded-[16px] bg-black">
                        <iframe
                            src={streamPlayerUrl(video.id, video.startSeconds)}
                            title={video.title}
                            className="block size-full border-0"
                            allow="autoplay; fullscreen; picture-in-picture"
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-4 px-2 pb-1 pt-4 sm:px-5">
                        <div className="flex min-w-0 flex-col gap-1">
                            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                {guide.title} walkthrough
                            </span>
                            <DialogTitle className="m-0 text-[16px] font-semibold leading-snug text-foreground">
                                {guide.headline}
                            </DialogTitle>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button asChild variant="outline">
                                <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                                    <BookOpen aria-hidden />
                                    Read the docs
                                </a>
                            </Button>
                            <Button onClick={() => setGuideKey(null)}>
                                Close
                                <Kbd tone="inverse">Esc</Kbd>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            ) : null}
        </Dialog>
    )
}
