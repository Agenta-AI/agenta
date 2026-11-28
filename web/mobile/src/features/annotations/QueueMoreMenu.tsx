import {annotationSessionController, getAddToTestsetDisabledReason} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Copy, DotsThree, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * The content bar's "More": "Add to test set" for this item (it needs the item completed and
 * saved; the reason shows under the entries) and the copy of the item's trace or test case ID.
 */
export const QueueMoreMenu = ({
    scenarioId,
    submission,
}: {
    scenarioId: string
    submission: {isCompleted: boolean; isSubmitting: boolean; hasPendingChanges: boolean}
}) => {
    const t = useT(queueScreensCatalog)
    const {traceId} = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const {testcaseId} = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const openAddToTestset = useSetAtom(annotationSessionController.actions.openAddToTestsetModal)
    const disabledReason = getAddToTestsetDisabledReason({scenarioId, ...submission})
    // A run's item has both; its test case is what a reader looks up.
    const copyId = testcaseId || traceId
    const copy = () =>
        void copyToClipboard(copyId).then((copied) => {
            if (copied) message.success("Copied")
        })

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("annotation.queueScreens.more")}
                    title={t("annotation.queueScreens.more")}
                >
                    <DotsThree aria-hidden size={16} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-60">
                <DropdownMenuItem
                    disabled={Boolean(disabledReason)}
                    onSelect={() => openAddToTestset({scope: "single", scenarioIds: [scenarioId]})}
                >
                    <Plus aria-hidden size={14} />
                    Add to test set
                </DropdownMenuItem>
                {copyId ? (
                    <DropdownMenuItem onSelect={copy}>
                        <Copy aria-hidden size={14} />
                        {t(
                            testcaseId
                                ? "annotation.queueScreens.copyTestcaseId"
                                : "annotation.queueScreens.copyTraceId",
                        )}
                    </DropdownMenuItem>
                ) : null}
                {disabledReason ? (
                    <p className="m-0 px-2 py-1.5 text-meta text-muted-foreground">
                        {disabledReason}
                    </p>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
