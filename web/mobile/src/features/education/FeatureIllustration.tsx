import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"

/** Stands in for the walkthrough still: the feature's icon on a dotted field. */
export const FeatureIllustration = ({guideKey}: {guideKey: FeatureGuideKey}) => {
    const {main: Main, left: Left, right: Right} = FEATURE_GUIDES[guideKey].icons
    const side =
        "flex h-[76px] w-[84px] items-center justify-center rounded-[16px] border border-solid border-colorBorderSecondary bg-background/70 text-colorTextTertiary"

    return (
        <>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:linear-gradient(90deg,transparent,black_45%)] @xl:block"
            />
            <div
                aria-hidden
                className="relative hidden h-[200px] items-center justify-center @xl:flex"
            >
                <span className={`${side} -mr-4 -rotate-6`}>
                    <Left size={24} />
                </span>
                <span className="relative z-[1] flex size-[88px] items-center justify-center rounded-[20px] border border-solid border-colorBorderSecondary bg-background text-foreground shadow-overlay">
                    <Main size={34} />
                </span>
                <span className={`${side} -ml-4 rotate-6`}>
                    <Right size={24} />
                </span>
            </div>
        </>
    )
}
