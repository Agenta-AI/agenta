import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import listControlsCatalog from "@agenta/i18n/catalogs/ui.listControls"

import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia} from "../ui/empty"

import {Button} from "../ui/button"

interface Cta {
    text: string
    onClick?: () => void
    icon?: ReactNode
    tooltip?: string
    variant?: "primary" | "default"
    size?: "small" | "middle" | "large"
}

// antd size names kept on the public Cta.
const toSize = (size: Cta["size"]) => (size === "small" ? "sm" : size === "middle" ? "default" : "lg")

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
}: EmptyPlaceholderProps) => {
    const t = useT(listControlsCatalog)
    return (
        <Empty className={className}>
            <EmptyHeader>
                {image ? <EmptyMedia className="text-muted-foreground">{image}</EmptyMedia> : null}
                {description ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            <EmptyContent className="gap-2">
                {primaryCta ? (
                    <Button
                        size={toSize(primaryCta.size)}
                        variant={primaryCta.variant === "default" ? "outline" : "default"}
                        onClick={primaryCta.onClick}
                        title={primaryCta.tooltip}
                    >
                        {primaryCta.icon}
                        {primaryCta.text}
                    </Button>
                ) : null}
                {secondaryCta ? (
                    <>
                        {/* The separator only makes sense between two CTAs; a secondary-only state
                        used to render an orphaned "Or". */}
                        {primaryCta ? (
                            <span className="text-foreground">{t("ui.listControls.or")}</span>
                        ) : null}
                        <Button
                            size={toSize(secondaryCta.size)}
                            variant={secondaryCta.variant === "primary" ? "default" : "outline"}
                            onClick={secondaryCta.onClick}
                            title={secondaryCta.tooltip}
                        >
                            {secondaryCta.icon}
                            {secondaryCta.text}
                        </Button>
                    </>
                ) : null}
            </EmptyContent>
        </Empty>
    )
}

export default EmptyPlaceholder
