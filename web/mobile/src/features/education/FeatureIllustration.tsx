import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"

/** Stands in for the walkthrough still: the feature's icon on a dotted field. */
export const FeatureIllustration = ({guideKey}: {guideKey: FeatureGuideKey}) => {
    const {main: Main, left: Left, right: Right} = FEATURE_GUIDES[guideKey].icons
    const side =
        "flex h-19 w-21 items-center justify-center rounded-lg border border-solid border-border-muted bg-background/70 text-muted-foreground"

    return (
        <>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:linear-gradient(90deg,transparent,black_45%)] @xl:block"
            />
            <div
                aria-hidden
                className="relative hidden h-50 items-center justify-center @xl:flex"
            >
                <span className={`${side} -mr-4 -rotate-6`}>
                    <Left size={24} />
                </span>
                <span className="relative z-[1] flex size-22 items-center justify-center rounded-xl border border-solid border-border-muted bg-background text-foreground">
                    <Main size={34} />
                </span>
                <span className={`${side} -ml-4 rotate-6`}>
                    <Right size={24} />
                </span>
            </div>
        </>
    )
}
