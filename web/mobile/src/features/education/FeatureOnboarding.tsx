import type {ReactNode} from "react"

import {type FeatureGuideKey} from "./featureGuides"
import {FeatureOnboardingBanner} from "./FeatureOnboardingBanner"
import {FeatureTemplateStarters} from "./FeatureTemplateStarters"

/** Replaces a list page's toolbar and table while the project has none of the thing. */
export const FeatureOnboarding = ({
    guideKey,
    base,
    children,
}: {
    guideKey: FeatureGuideKey
    base: string
    /** Replaces the template grid, for a page whose starting points are not agent templates. */
    children?: ReactNode
}) => (
    <div className="@container flex flex-col gap-8 pt-1">
        <FeatureOnboardingBanner guideKey={guideKey} />
        {children ?? <FeatureTemplateStarters guideKey={guideKey} base={base} />}
    </div>
)
