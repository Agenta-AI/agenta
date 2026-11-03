import type {ReactNode} from "react"

import {Button, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {CaretDownIcon, CaretUpIcon} from "@phosphor-icons/react"

import type {RevisionDrawerKind} from "./types"

const TITLES: Record<RevisionDrawerKind, string> = {
    variant: "Workflow Revision",
    deployment: "Deployment",
    evaluator: "Evaluator",
}

export const RevisionDrawerHeader = ({
    revisionId,
    kind,
    navigationIds = [],
    onNavigate,
    actions,
}: {
    revisionId: string
    kind: RevisionDrawerKind
    navigationIds?: readonly string[]
    onNavigate?: (revisionId: string) => void
    actions?: ReactNode
}) => {
    const index = navigationIds.indexOf(revisionId)
    const previousId = index > 0 ? navigationIds[index - 1] : undefined
    const nextId = index >= 0 ? navigationIds[index + 1] : undefined

    return (
        <SheetHeader className="border-0 border-b border-solid border-border py-2.5">
            <div className="flex min-w-0 items-center gap-2">
                <SheetTitle className="min-w-0 flex-1 truncate">{TITLES[kind]}</SheetTitle>
                {navigationIds.length > 1 ? (
                    <>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Previous revision"
                            disabled={!previousId}
                            onClick={() => previousId && onNavigate?.(previousId)}
                        >
                            <CaretUpIcon />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Next revision"
                            disabled={!nextId}
                            onClick={() => nextId && onNavigate?.(nextId)}
                        >
                            <CaretDownIcon />
                        </Button>
                    </>
                ) : null}
                {actions}
            </div>
        </SheetHeader>
    )
}
