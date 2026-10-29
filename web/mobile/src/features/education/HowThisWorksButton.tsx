import {Button} from "@agenta/ui/ui"
import {PlayCircle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import {FEATURE_GUIDES, type FeatureGuideKey} from "./featureGuides"

/** The populated page's quiet way back to the walkthrough; renders nothing until there is a video. */
export const HowThisWorksButton = ({
    guide,
    className,
}: {
    guide: FeatureGuideKey
    className?: string
}) => {
    const openGuide = useSetAtom(openFeatureGuideAtom)
    const {title, headline, docsUrl, video} = FEATURE_GUIDES[guide]
    if (!video) return null

    return (
        <Button
            variant="ghost"
            className={className}
            onClick={() => openGuide({title, headline, docsUrl, video})}
        >
            <PlayCircle aria-hidden />
            How {title.toLowerCase()} work
        </Button>
    )
}
