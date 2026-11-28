import {useMemo} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {useModifierKey} from "@agenta/shared/hooks"
import {COARSE_POINTER_QUERY, useWindowMatch} from "@agenta/ui/hooks"
import {Kbd, LoadingButton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import type {FocusedField} from "./useFieldFocus"
import type {useSubmitAnnotations} from "./useSubmitAnnotations"

const timeOf = (at: string | undefined) => (at ? Date.parse(at) || 0 : 0)

/** The item's last saved annotation: whoever wrote it, and when. One shared value per item. */
const useLastAuthor = (scenarioId: string) => {
    const annotations = useAtomValue(
        annotationSessionController.selectors.scenarioAnnotations(scenarioId),
    )
    return useMemo(() => {
        let last: {userId: string; at: string} | null = null
        for (const annotation of annotations) {
            const at = annotation.updated_at ?? annotation.created_at
            if (!annotation.created_by_id || !at) continue
            if (!last || timeOf(at) > timeOf(last.at)) {
                last = {userId: annotation.created_by_id, at}
            }
        }
        return last
    }, [annotations])
}

/** The line under the button: why it is off, else what the keys do on the field in focus. */
const useHelpLine = (
    submission: ReturnType<typeof useSubmitAnnotations>,
    focused: FocusedField | null,
) => {
    const t = useT(queueScreensCatalog)
    const touch = useWindowMatch(COARSE_POINTER_QUERY)
    if (!submission.isCompleted && !submission.hasFilledMetrics) {
        return t("annotation.queueScreens.fillOneField")
    }
    // Key help is for a keyboard: on touch (a coarse pointer) only the reason above shows.
    if (touch) return null
    switch (focused?.kind) {
        case "boolean":
            return t("annotation.queueScreens.keysBoolean")
        case "choice":
            return t("annotation.queueScreens.keysChoice", {count: focused.optionCount})
        case "slider":
            return t("annotation.queueScreens.sliderHelp", {step: focused.step})
        default:
            return t("annotation.queueScreens.keysHelp")
    }
}

/**
 * The panel's one primary button: "Mark completed and next" (saves, completes, opens the next item
 * in "Needs review"), or "Update" on a completed item. Above it the last author, under it the
 * line that says why it is off or what the keys do.
 */
export const QueueSubmitBar = ({
    scenarioId,
    submission,
    focused,
}: {
    scenarioId: string
    submission: ReturnType<typeof useSubmitAnnotations>
    focused: FocusedField | null
}) => {
    const modifierKey = useModifierKey()
    const touch = useWindowMatch(COARSE_POINTER_QUERY)
    const author = useLastAuthor(scenarioId)
    const help = useHelpLine(submission, focused)
    return (
        <div className="flex shrink-0 flex-col gap-2 border-0 border-t border-solid border-border px-4 py-3">
            {author ? (
                <span className="text-meta text-muted-foreground">
                    <UserAuthorLabel userId={author.userId} at={author.at} />
                </span>
            ) : null}
            <LoadingButton
                type="button"
                className="w-full"
                loading={submission.isSubmitting}
                disabled={!submission.canSubmit}
                onClick={() => void submission.submit()}
            >
                {submission.label}
                {touch ? null : <Kbd tone="inverse" className="ml-0.5">{`${modifierKey}↵`}</Kbd>}
            </LoadingButton>
            {help ? (
                <p className="m-0 text-center text-meta text-muted-foreground">{help}</p>
            ) : null}
        </div>
    )
}
