import {Button} from "@agenta/ui/ui"
import {Question} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {openFeatureGuideAtom} from "./featureGuideAtom"
import type {FeatureGuideKey} from "./featureGuides"

/**
 * The persistent entry point to a feature guide — a quiet ghost button, so the screen
 * teaches on demand instead of interrupting. This is the populated-screen path: content
 * an agent created still needs the user to discover how the feature works by hand.
 */
export const HowThisWorksButton = ({
    guide,
    label = "How this works",
    className,
}: {
    guide: FeatureGuideKey
    label?: string
    className?: string
}) => {
    const openGuide = useSetAtom(openFeatureGuideAtom)
    return (
        <Button variant="ghost" size="sm" className={className} onClick={() => openGuide(guide)}>
            <Question size={15} aria-hidden />
            {label}
        </Button>
    )
}
