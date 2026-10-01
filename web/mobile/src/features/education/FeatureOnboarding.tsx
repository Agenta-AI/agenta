import type {ReactNode} from "react"

import {useNewAgentAction} from "../agents/useNewAgentAction"

import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"
import {FeatureOnboardingBanner} from "./FeatureOnboardingBanner"
import {FeatureTemplateGrid} from "./FeatureTemplateGrid"

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
}) => {
    const newAgent = useNewAgentAction(base)

    return (
        <div className="@container flex flex-col gap-8 pt-1">
            <FeatureOnboardingBanner guideKey={guideKey} />
            {children ?? (
                <>
                    <FeatureTemplateGrid
                        templateKeys={FEATURE_GUIDES[guideKey].templateKeys}
                        browseHref={`${base}/templates`}
                        disabled={newAgent.creating}
                        onSelect={(template) => newAgent.createFromTemplate(template.key)}
                    />
                    {newAgent.error ? (
                        <p role="alert" className="m-0 -mt-5 text-[12.5px] text-destructive">
                            {newAgent.error}
                        </p>
                    ) : null}
                </>
            )}
        </div>
    )
}
