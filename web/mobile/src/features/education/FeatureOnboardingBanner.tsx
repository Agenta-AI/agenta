import {Button} from "@agenta/ui/ui"
import {ArrowUpRight, Play} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"
import {streamThumbnailUrl} from "./streamMedia"

/** What the feature is for, beside a walkthrough still that opens the lightbox. */
export const FeatureOnboardingBanner = ({guideKey}: {guideKey: FeatureGuideKey}) => {
    const guide = FEATURE_GUIDES[guideKey]
    const {video} = guide
    const openGuide = useSetAtom(openFeatureGuideAtom)
    const watch = () => openGuide(guideKey)

    return (
        <section
            className={`relative grid items-center gap-5 overflow-hidden rounded-[14px] border border-solid border-colorBorderSecondary bg-muted px-7 py-6 @xl:gap-6 @3xl:gap-10 ${video ? "@xl:grid-cols-2 @3xl:grid-cols-[1fr_420px]" : ""}`}
        >
            {/* Sized by the container, not the viewport: the sidebar takes its share first. */}
            {video ? (
                <>
                    <button
                        type="button"
                        onClick={watch}
                        aria-label={`Watch ${video.title}`}
                        className="absolute inset-y-0 right-0 hidden w-[58%] cursor-pointer border-0 bg-black p-0 @3xl:block"
                    >
                        <img
                            src={streamThumbnailUrl(video.id, video.startSeconds)}
                            alt=""
                            className="block size-full object-cover"
                        />
                    </button>
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,var(--muted)_42%,color-mix(in_srgb,var(--muted)_85%,transparent)_55%,color-mix(in_srgb,var(--muted)_20%,transparent)_78%,transparent)] @3xl:block"
                    />
                </>
            ) : null}

            <div className="relative z-[1] flex min-w-0 flex-col gap-5">
                {video ? (
                    <span className="box-border inline-flex h-6 w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-solid border-colorBorderSecondary bg-background pl-1 pr-2.5 text-[12px] text-zinc-8">
                        <span className="inline-flex size-4 items-center justify-center rounded-full bg-hero-action text-hero-action-foreground">
                            <Play size={7} weight="fill" aria-hidden />
                        </span>
                        {guide.title} walkthrough
                    </span>
                ) : null}
                <div className="flex flex-col gap-2.5">
                    <h2 className="m-0 text-balance text-[24px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
                        {guide.headline}
                    </h2>
                    <p className="m-0 max-w-[46ch] text-[14.5px] leading-[1.6] text-muted-foreground">
                        {guide.body}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {video ? (
                        <Button size="sm" onClick={watch}>
                            <Play weight="fill" className="size-[11px]" aria-hidden />
                            Watch video
                        </Button>
                    ) : null}
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="border-colorBorderSecondary hover:border-colorTextQuaternary hover:bg-background"
                    >
                        <a href={guide.docsUrl} target="_blank" rel="noreferrer">
                            Docs
                            <ArrowUpRight className="size-3" aria-hidden />
                        </a>
                    </Button>
                </div>
            </div>
            {video ? (
                <>
                    {/* Narrow containers: a framed still, stacked on top, then beside the text. */}
                    <button
                        type="button"
                        onClick={watch}
                        aria-label={`Watch ${video.title}`}
                        className="relative order-first block aspect-video w-full cursor-pointer overflow-hidden rounded-[10px] border border-solid border-colorBorderSecondary bg-black p-0 @xl:order-none @3xl:hidden"
                    >
                        <img
                            src={streamThumbnailUrl(video.id, video.startSeconds)}
                            alt=""
                            className="block size-full object-cover"
                        />
                        <span className="absolute bottom-3 left-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-background pl-1 pr-2.5 text-[12px] font-medium text-foreground shadow-overlay">
                            <span className="inline-flex size-5 items-center justify-center rounded-full bg-hero-action text-hero-action-foreground">
                                <Play size={9} weight="fill" aria-hidden />
                            </span>
                            Play
                        </span>
                    </button>
                    <div aria-hidden className="hidden h-[240px] @3xl:block" />
                </>
            ) : null}
        </section>
    )
}
