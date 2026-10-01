import {Button, Dialog, DialogContent, DialogTitle} from "@agenta/ui/ui"
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
                    className="max-w-[880px] gap-0 overflow-hidden rounded-2xl p-0 shadow-dialog"
                >
                    <div className="aspect-video w-full bg-black">
                        <iframe
                            src={streamPlayerUrl(video.id, video.startSeconds)}
                            title={video.title}
                            className="block size-full border-0"
                            allow="autoplay; fullscreen; picture-in-picture"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3 px-[18px] py-3.5">
                        <DialogTitle className="m-0 truncate text-[14px] font-semibold leading-5 text-foreground">
                            {video.title}
                        </DialogTitle>
                        <div className="flex shrink-0 items-center gap-3">
                            <a
                                href={guide.docsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[13px] text-muted-foreground no-underline hover:text-foreground"
                            >
                                Read the docs
                            </a>
                            <Button
                                variant="secondary"
                                className="h-[30px] rounded-lg bg-accent px-3 hover:bg-colorBorderSecondary"
                                onClick={() => setGuideKey(null)}
                            >
                                Done
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            ) : null}
        </Dialog>
    )
}
