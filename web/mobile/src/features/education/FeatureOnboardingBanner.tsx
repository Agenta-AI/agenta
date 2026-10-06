import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, Play} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"
import {FeatureIllustration} from "./FeatureIllustration"
import {streamThumbnailUrl} from "./streamMedia"

/** What the feature is for, beside a walkthrough still (or an illustration when there is none). */
export const FeatureOnboardingBanner = ({guideKey}: {guideKey: FeatureGuideKey}) => {
    const guide = FEATURE_GUIDES[guideKey]
    const {video} = guide
    const openGuide = useSetAtom(openFeatureGuideAtom)
    const watch = () => openGuide(guideKey)

    return (
        <section className="relative grid items-center gap-5 overflow-hidden rounded-[14px] border border-solid border-colorBorderSecondary bg-muted px-7 py-6 @xl:grid-cols-2 @xl:gap-6 @3xl:grid-cols-[1fr_420px] @3xl:gap-10">
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
                            src={streamThumbnailUrl(video.id, video.stillSeconds)}
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
                    <span className="box-border inline-flex h-6 w-fit items-center gap-1.5 whitespace-nowrap rounded-md border border-solid border-colorBorderSecondary bg-background pl-1 pr-2.5 text-[12px] text-zinc-8">
                        <span className="inline-flex size-4 items-center justify-center rounded bg-hero-action text-hero-action-foreground">
                            <Play size={7} weight="fill" aria-hidden />
                        </span>
                        {guide.title} walkthrough
                    </span>
                ) : null}
                <div className="flex flex-col gap-2.5">
                    <h2 className="m-0 text-balance text-[20px] font-semibold @xl:text-[22px] @3xl:text-[24px] leading-[1.1] tracking-[-0.03em] text-foreground">
                        {guide.headline}
                    </h2>
                    <p className="m-0 max-w-[46ch] text-[14px] leading-[1.6] @3xl:text-[14.5px] text-muted-foreground">
                        {guide.body}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {video ? (
                        <Button size="sm" onClick={watch}>
                            <Play className="size-3" aria-hidden />
                            Watch video
                        </Button>
                    ) : null}
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="border-colorBorderSecondary hover:border-colorTextQuaternary hover:bg-background"
                    >
                        <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
                            Read the docs
                            <ArrowSquareOut className="size-3.5" aria-hidden />
                        </a>
                    </Button>
                </div>
            </div>
            {video ? (
                <>
                    {/* Narrow containers: the still on stacked cards, on top, then beside the text. */}
                    <div className="relative order-first pl-3.5 pt-3.5 @xl:order-none @3xl:hidden">
                        <div
                            aria-hidden
                            className="absolute bottom-7 left-0 right-7 top-0 -rotate-[2.5deg] rounded-[14px] border border-solid border-colorBorderSecondary bg-background opacity-70"
                        />
                        <div
                            aria-hidden
                            className="absolute bottom-3.5 left-[7px] right-3.5 top-[7px] -rotate-[1.2deg] rounded-[14px] border border-solid border-colorBorderSecondary bg-background"
                        />
                        <button
                            type="button"
                            onClick={watch}
                            aria-label={`Watch ${video.title}`}
                            className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-[14px] border-0 bg-black p-0 shadow-overlay outline outline-4 outline-background"
                        >
                            <img
                                src={streamThumbnailUrl(video.id, video.stillSeconds)}
                                alt=""
                                className="block size-full object-cover"
                            />
                            <span className="absolute left-1/2 top-1/2 inline-flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-black shadow-overlay ring-[6px] ring-white/20">
                                <Play size={14} weight="fill" className="ml-0.5" aria-hidden />
                            </span>
                        </button>
                    </div>
                    <div aria-hidden className="hidden h-[240px] @3xl:block" />
                </>
            ) : (
                <FeatureIllustration guideKey={guideKey} />
            )}
        </section>
    )
}
