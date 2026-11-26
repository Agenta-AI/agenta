import {deriveEvaluationKind, type EvaluationRun} from "@agenta/entities/evaluationRun"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    Copy,
    Database,
    DotsThreeVertical,
    Note,
    Play,
    Rocket,
    Stop,
    Trash,
} from "@phosphor-icons/react"

import {isRunActive, isRunClosed, readRunReferences} from "./runReferences"
import type {RunRowActions} from "./useRunRowActions"

/**
 * A run's own actions. Stop, resume and delete show only to a reader who may edit runs, so the
 * menu never offers a verb that the server then refuses.
 */
export const RunRowMenu = ({run, actions}: {run: EvaluationRun; actions: RunRowActions}) => {
    const refs = readRunReferences(run)
    const live = deriveEvaluationKind(run) === "online" && !isRunClosed(run)
    const active = isRunActive(run)
    const busy = actions.isBusy(run.id)

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Run actions"
                    className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                >
                    <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
                <DropdownMenuItem onSelect={() => actions.open(run)}>
                    <Note aria-hidden size={14} />
                    Open details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void actions.copyId(run)}>
                    <Copy aria-hidden size={14} />
                    Copy run ID
                </DropdownMenuItem>
                {live && actions.canEdit ? (
                    <DropdownMenuItem
                        disabled={busy}
                        onSelect={() => void actions.toggleLive(run, active)}
                    >
                        {active ? <Stop aria-hidden size={14} /> : <Play aria-hidden size={14} />}
                        {active ? "Stop evaluation" : "Resume evaluation"}
                    </DropdownMenuItem>
                ) : null}
                {refs.applicationRevisionId ? (
                    <DropdownMenuItem onSelect={() => actions.viewVariant(run)}>
                        <Rocket aria-hidden size={14} />
                        View variant
                    </DropdownMenuItem>
                ) : null}
                {(refs.testsetRevisionId || refs.testsetId) && actions.testsetsViewOn ? (
                    <DropdownMenuItem onSelect={() => actions.viewTestset(run)}>
                        <Database aria-hidden size={14} />
                        View test set
                    </DropdownMenuItem>
                ) : null}
                {actions.canEdit ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={busy}
                            onSelect={() => actions.remove(run)}
                        >
                            <Trash aria-hidden size={14} />
                            Delete
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
