import {useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {FEATURE_GUIDES, streamIframeSrc} from "./featureGuides"

/**
 * The "How this works" dialog: a short demo clip (the docs' Cloudflare Stream video),
 * the written explanation, and the way to the full guide.
 *
 * Always USER-TRIGGERED — an entry point opens it, it never opens itself. Auto-opening
 * a modal over a populated screen interrupts someone mid-task, which is the same
 * failure mode as a login modal. Mounted once app-wide by `GlobalDrawers`; the iframe
 * exists only while the dialog is open, so no Stream request rides page load. A
 * deployment that cannot reach cloudflarestream.com still gets the text and the docs
 * link — the iframe's error handler swaps the player for the fallback.
 */
export const FeatureGuideDialog = () => {
    const [guideKey, setGuideKey] = useAtom(openFeatureGuideAtom)
    const [videoFailed, setVideoFailed] = useState(false)
    const guide = guideKey ? FEATURE_GUIDES[guideKey] : null

    return (
        <Dialog
            open={guide !== null}
            onOpenChange={(open) => {
                if (!open) {
                    setGuideKey(null)
                    setVideoFailed(false)
                }
            }}
        >
            {guide ? (
                <DialogContent className="max-w-[640px]">
                    <DialogHeader>
                        <DialogTitle>{guide.title}</DialogTitle>
                        <DialogDescription className="text-left leading-snug">
                            {guide.blurb}
                        </DialogDescription>
                    </DialogHeader>
                    {videoFailed ? (
                        <p className="m-0 rounded-[9px] bg-muted px-4 py-6 text-center text-[13px] text-muted-foreground">
                            The demo video could not load here. The guide below shows the same flow.
                        </p>
                    ) : (
                        <div className="aspect-video w-full overflow-hidden rounded-[9px] bg-muted">
                            <iframe
                                src={streamIframeSrc(guide)}
                                title={guide.title}
                                className="size-full border-0"
                                allow="fullscreen; picture-in-picture"
                                loading="lazy"
                                onError={() => setVideoFailed(true)}
                            />
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-[13px] leading-snug text-muted-foreground">
                            Tip: in chat, try “{guide.askAgentExample}”
                        </p>
                        <Button asChild variant="outline" size="sm">
                            <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                                Read the guide
                                <ArrowSquareOut size={14} aria-hidden />
                            </a>
                        </Button>
                    </div>
                </DialogContent>
            ) : null}
        </Dialog>
    )
}
