import type {ReactNode} from "react"

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
    description = "The request did not come back. Check your connection and try again.",
    onRetry,
    retryLabel = "Try again",
    framed = false,
    className,
}: LoadErrorProps) => (
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

export default LoadError
