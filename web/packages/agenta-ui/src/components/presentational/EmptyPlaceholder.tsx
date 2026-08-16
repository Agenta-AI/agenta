import type {ReactNode} from "react"

import {cn} from "../../utils/styles"

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
 * antd `Empty` replacement — a centred image + description with up to two CTAs.
 * The image is a slot, so callers bring their own icon set.
 */
export const EmptyPlaceholder = ({
    image,
    description,
    primaryCta,
    secondaryCta,
    className,
}: EmptyPlaceholderProps) => (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
        {image ? (
            <div className="mb-6 grid place-items-center text-colorTextSecondary">{image}</div>
        ) : null}
        {description ? (
            <div className="mb-6 text-base text-colorTextSecondary">{description}</div>
        ) : null}
        <div className="flex flex-col items-center gap-2">
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
        </div>
    </div>
)

export default EmptyPlaceholder
