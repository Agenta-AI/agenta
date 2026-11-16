import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {RefreshCw, TriangleAlert} from "lucide-react"

import {cn} from "../../../utils/styles"
import {Button} from "../../ui/button"
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "../../ui/empty"

export interface LoadErrorProps {
    /** What failed: "Could not load skills". */
    title: ReactNode
    description?: ReactNode
    /** Present ⇒ a Try again button. */
    onRetry?: () => void
    retryLabel?: ReactNode
    /** Solid border, for when the state replaces the results outright. */
    framed?: boolean
    className?: string
}

/** A fetch that never answered — never an empty state, since "nothing here" is a claim. */
export const LoadError = ({
    title,
    description: descriptionProp,
    onRetry,
    retryLabel: retryLabelProp,
    framed = false,
    className,
}: LoadErrorProps) => {
    const t = useT(uiControlsCatalog, commonCatalog)
    const description = descriptionProp ?? t("ui.controls.loadError")
    const retryLabel = retryLabelProp ?? t("common.tryAgain")
    return (
        <Empty
            role="alert"
            className={cn("py-14", framed && "border border-solid border-border", className)}
        >
            <EmptyHeader>
                <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
                    <TriangleAlert />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            {onRetry ? (
                <EmptyContent>
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        <RefreshCw />
                        {retryLabel}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}

export default LoadError
