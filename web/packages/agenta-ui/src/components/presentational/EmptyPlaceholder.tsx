import type {ReactNode} from "react"

import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia} from "../ui/empty"

import EnhancedButton from "./EnhancedButton"

interface Cta {
    text: string
    onClick?: () => void
    icon?: ReactNode
    tooltip?: string
    variant?: "primary" | "default"
    size?: "small" | "middle" | "large"
}

export interface EmptyPlaceholderProps {
    image?: ReactNode
    description?: ReactNode
    primaryCta?: Cta
    secondaryCta?: Cta
    className?: string
}

/**
 * antd `Empty` replacement — the shadcn `Empty` parts with up to two CTAs.
 * The image is a slot, so callers bring their own icon set.
 */
export const EmptyPlaceholder = ({
    image,
    description,
    primaryCta,
    secondaryCta,
    className,
}: EmptyPlaceholderProps) => (
    <Empty className={className}>
        <EmptyHeader>
            {image ? <EmptyMedia className="text-muted-foreground">{image}</EmptyMedia> : null}
            {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
        <EmptyContent className="gap-2">
            {primaryCta ? (
                <EnhancedButton
                    size={primaryCta.size ?? "large"}
                    icon={primaryCta.icon}
                    type={primaryCta.variant ?? "primary"}
                    onClick={primaryCta.onClick}
                    title={primaryCta.tooltip}
                >
                    {primaryCta.text}
                </EnhancedButton>
            ) : null}
            {secondaryCta ? (
                <>
                    {/* The separator only makes sense between two CTAs; a secondary-only state
                        used to render an orphaned "Or". */}
                    {primaryCta ? <span className="text-colorText">Or</span> : null}
                    <EnhancedButton
                        size={secondaryCta.size ?? "large"}
                        icon={secondaryCta.icon}
                        type={secondaryCta.variant ?? "default"}
                        onClick={secondaryCta.onClick}
                        title={secondaryCta.tooltip}
                    >
                        {secondaryCta.text}
                    </EnhancedButton>
                </>
            ) : null}
        </EmptyContent>
    </Empty>
)

export default EmptyPlaceholder
