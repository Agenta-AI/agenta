import {useNewAgentAction} from "../agents/useNewAgentAction"

import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"
import {FeatureTemplateGrid} from "./FeatureTemplateGrid"

/** The guide's template picks, each creating an agent from that template. */
export const FeatureTemplateStarters = ({
    guideKey,
    base,
}: {
    guideKey: FeatureGuideKey
    base: string
}) => {
    const newAgent = useNewAgentAction(base)

    return (
        <div className="flex flex-col gap-3">
            <FeatureTemplateGrid
                templateKeys={FEATURE_GUIDES[guideKey].templateKeys}
                browseHref={`${base}/templates`}
                disabled={newAgent.creating}
                onSelect={(template) => newAgent.createFromTemplate(template.key)}
            />
            {newAgent.error ? (
                <p role="alert" className="m-0 text-[12.5px] text-destructive">
                    {newAgent.error}
                </p>
            ) : null}
        </div>
    )
}
