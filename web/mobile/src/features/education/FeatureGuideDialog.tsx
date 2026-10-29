import {Button, Dialog, DialogContent, DialogTitle, Kbd} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {guidePlayerUrl} from "./streamMedia"

/** The walkthrough lightbox; `GlobalDrawers` mounts it and `openFeatureGuideAtom` opens it. */
export const FeatureGuideDialog = () => {
    const [guide, setGuide] = useAtom(openFeatureGuideAtom)
    const video = guide?.video

    return (
        <Dialog open={Boolean(video)} onOpenChange={(open) => !open && setGuide(null)}>
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
                    className="max-w-[1000px] gap-0 overflow-hidden rounded-[20px] p-2 shadow-dialog"
                >
                    <div className="aspect-video w-full overflow-hidden rounded-[14px] bg-black">
                        <iframe
                            src={guidePlayerUrl(video)}
                            title={video.title}
                            className="block size-full border-0"
                            allow="autoplay; fullscreen; picture-in-picture"
                            // YouTube refuses to play an embed that sends no referrer.
                            referrerPolicy="strict-origin-when-cross-origin"
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-3 sm:px-3">
                        <div className="flex min-w-0 flex-col gap-1">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                {guide.title} walkthrough
                            </span>
                            <DialogTitle className="m-0 text-[16px] font-semibold leading-snug text-foreground">
                                {guide.headline}
                            </DialogTitle>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button asChild size="sm" variant="outline">
                                <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                                    Read the docs
                                    <ArrowSquareOut aria-hidden />
                                </a>
                            </Button>
                            <Button size="sm" onClick={() => setGuide(null)}>
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
