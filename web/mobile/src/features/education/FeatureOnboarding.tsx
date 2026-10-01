import {useNewAgentAction} from "../agents/useNewAgentAction"

import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"
import {FeatureOnboardingBanner} from "./FeatureOnboardingBanner"
import {FeatureTemplateGrid} from "./FeatureTemplateGrid"

/** Replaces a list page's toolbar and table while the project has none of the thing. */
export const FeatureOnboarding = ({guideKey, base}: {guideKey: FeatureGuideKey; base: string}) => {
    const newAgent = useNewAgentAction(base)

    return (
        <div className="@container flex flex-col gap-8 pt-5">
            <FeatureOnboardingBanner guideKey={guideKey} />
            <FeatureTemplateGrid
                templateKeys={FEATURE_GUIDES[guideKey].templateKeys}
                onSelect={(template) => newAgent.createFromTemplate(template.key)}
            />
        </div>
    )
}
