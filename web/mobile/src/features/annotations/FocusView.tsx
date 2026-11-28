import {useState} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {ValueViewProvider} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {projectIdAtom} from "@agenta/shared/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {
    Button,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetTitle,
    SkeletonBlock,
    SplitPane,
} from "@agenta/ui/ui"
import {CheckCircle, LockSimple, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {chatProseClassName, markdownIcons} from "@/features/chat/AssistantMarkdown"
import {useProjectPermission} from "@/features/context/useProjectPermission"
import {useRunAnnotationRefresh} from "@/features/evaluation-run/focus/useRunAnnotationSession"

import {AnnotationFormPanel} from "./AnnotationFormPanel"
import {QueueContentBar} from "./QueueContentBar"
import {QueueItemList} from "./QueueItemList"
import {useQueueRunItem} from "./QueueRunItemContent"
import {QueueSubmitBar} from "./QueueSubmitBar"
import {PANEL_WIDTH_KEY, readStoredSize, writeStoredSize} from "./queueViewStorage"
import {RunInvocationPanel} from "./RunInvocationPanel"
import {ScenarioContent} from "./ScenarioContent"
import {ScenarioMessage} from "./ScenarioMessage"
import {useAnnotationKeyboardShortcuts} from "./useAnnotationKeyboardShortcuts"
import {useFieldFocus} from "./useFieldFocus"
import {useIsTraceQueue} from "./useIsTraceQueue"
import {useSubmitAnnotations} from "./useSubmitAnnotations"

const PANEL_WIDTH = 380
const PANEL_MIN = 320
const PANEL_MAX = 560
/** Below this width the item list starts folded. */
const LIST_OPEN_QUERY = "(min-width: 1360px)"
const COLUMNS_QUERY = "(min-width: 768px)"

/** Every item is completed: the reader can still open any of them, and add them to a test set. */
const AllCompletedLine = ({total}: {total: number}) => {
    const t = useT(queueScreensCatalog)
    const isExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const openAddToTestset = useSetAtom(annotationSessionController.actions.openAddToTestsetModal)
    return (
        <div className="flex flex-col gap-2">
            <div
                role="status"
                className="flex items-start gap-2.5 rounded-lg border border-solid border-border px-3 py-2.5"
            >
                <CheckCircle aria-hidden size={16} className="mt-px shrink-0 text-success" />
                <p className="m-0 text-body text-muted-foreground">
                    <span className="text-label text-foreground">
                        {t("annotation.queueScreens.allCompleted", {count: total})}
                    </span>{" "}
                    {t("annotation.queueScreens.allCompletedDetail")}
                </p>
            </div>
            <LoadingButton
                size="sm"
                variant="outline"
                className="w-full"
                loading={isExporting}
                onClick={() => openAddToTestset({scope: "complete"})}
            >
                <Plus aria-hidden size={14} />
                Add to test set
            </LoadingButton>
        </div>
    )
}

/**
 * The queue's Annotate tab, on one background with lines between the columns: the item list
 * (folded below about 1,360px, a sheet on a phone), the item's content under its bar, and the
 * annotation panel, whose width the reader drags between 320 and 560px. The panel's fields take
 * the keys; its one button completes the item and opens the next one that needs review.
 */
export const FocusView = ({
    queueId,
    canEditQueue = false,
    onOpenConfiguration,
}: {
    queueId: string
    /** The reader may edit the queue (`edit_evaluation_queues`): "Open Configuration" shows. */
    canEditQueue?: boolean
    onOpenConfiguration?: () => void
}) => {
    const t = useT(queueScreensCatalog)
    const wide = useMediaQuery(LIST_OPEN_QUERY)
    const columns = useMediaQuery(COLUMNS_QUERY)
    const [listChoice, setListChoice] = useState<boolean | null>(null)
    const listOpen = listChoice ?? wide
    const [panelWidth, setPanelWidth] = useState(
        () => readStoredSize(PANEL_WIDTH_KEY) ?? PANEL_WIDTH,
    )

    const currentId = useAtomValue(annotationSessionController.selectors.currentScenarioId())
    const scenarioId = currentId ?? ""
    const scenarios = useAtomValue(annotationSessionController.selectors.scenarioRecords())
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const activeRunId = useAtomValue(annotationSessionController.selectors.activeRunId())
    const isTraces = useIsTraceQueue()
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canAnnotate = useProjectPermission(projectId, "edit_annotations")
    const onSaved = useRunAnnotationRefresh(activeRunId ?? "")
    const submission = useSubmitAnnotations(scenarioId, {queueId}, onSaved)
    // Only a test case or test set queue can hold a run's items; a trace item has its own trace.
    const runItem = useQueueRunItem(isTraces ? "" : scenarioId)
    // A run's item has no output until someone runs the app: the form waits for it.
    const resultsUnknown = Boolean(runItem && !runItem.ready)
    const awaitingOutput = resultsUnknown || Boolean(runItem?.invocation.pending)
    const runsApp = Boolean(runItem?.invocation.pending && runItem.invocation.canRun) && canAnnotate
    const fieldFocus = useFieldFocus(scenarioId, canAnnotate && !awaitingOutput)

    useAnnotationKeyboardShortcuts({
        onPrev: () => navigatePrev(),
        onNext: () => navigateNext(),
        onSubmit: () => (runsApp ? runItem?.invocation.run() : void submission.submit()),
        hasPrev,
        hasNext,
        canSubmit: runsApp
            ? !runItem?.invocation.running
            : canAnnotate && !awaitingOutput && submission.canSubmit,
        enabled: Boolean(currentId),
    })

    const list = <QueueItemList onHide={columns ? () => setListChoice(false) : undefined} />
    const content = (
        <div className="flex min-h-0 flex-1 flex-col">
            <QueueContentBar
                scenarioId={scenarioId}
                onShowItems={listOpen && columns ? undefined : () => setListChoice(true)}
                submission={submission}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
                <div className="mx-auto flex max-w-4xl flex-col gap-6 pt-2">
                    {progress.total > 0 && progress.remaining === 0 ? (
                        <AllCompletedLine total={progress.total} />
                    ) : null}
                    <ValueViewProvider
                        markdownClassName={chatProseClassName}
                        markdownIcons={markdownIcons}
                    >
                        <ScenarioContent
                            scenarioId={scenarioId}
                            hasScenario={scenarios.some((record) => record.id === currentId)}
                            isTraces={isTraces}
                            traceId={traceRef.traceId}
                            testcaseId={testcaseRef.testcaseId}
                            runItem={runItem}
                        />
                    </ValueViewProvider>
                </div>
            </div>
        </div>
    )
    const readOnlyNotice = canAnnotate ? null : (
        <p className="m-0 flex items-start gap-2 px-4 pt-3 text-body-sm text-muted-foreground">
            <LockSimple aria-hidden size={14} className="mt-0.5 shrink-0" />
            {t("annotation.queueScreens.readOnly")}
        </p>
    )
    const panel = awaitingOutput ? (
        <div className="flex h-full min-h-0 flex-col">
            <h2 className="m-0 border-0 border-b border-solid border-border px-4 py-3 text-label">
                Annotations
            </h2>
            {resultsUnknown ? (
                runItem?.loadFailed ? (
                    <ScenarioMessage title={t("annotation.queueScreens.itemLoadFailed")} />
                ) : (
                    <div className="flex flex-col gap-3 p-4" role="status">
                        <SkeletonBlock className="h-8" />
                        <SkeletonBlock className="h-8" />
                    </div>
                )
            ) : runsApp && runItem ? (
                <RunInvocationPanel invocation={runItem.invocation} />
            ) : (
                <ScenarioMessage title="Run the invocation to generate output before annotating." />
            )}
        </div>
    ) : (
        <div
            ref={fieldFocus.ref}
            onFocus={fieldFocus.onFocus}
            onBlur={fieldFocus.onBlur}
            className="flex h-full min-h-0 flex-col"
        >
            <div className="min-h-0 flex-1">
                <AnnotationFormPanel
                    scenarioId={scenarioId}
                    queueId={queueId}
                    readOnly={!canAnnotate}
                    fieldKeys={canAnnotate}
                    onSaved={onSaved}
                    notice={readOnlyNotice}
                    emptyAction={
                        canEditQueue && onOpenConfiguration ? (
                            <Button size="sm" variant="outline" onClick={onOpenConfiguration}>
                                {t("annotation.queueScreens.openConfiguration")}
                            </Button>
                        ) : undefined
                    }
                />
            </div>
            {canAnnotate ? (
                <QueueSubmitBar
                    scenarioId={scenarioId}
                    submission={submission}
                    focused={fieldFocus.focused}
                />
            ) : null}
        </div>
    )

    if (!columns) {
        return (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {content}
                <div className="border-0 border-t border-solid border-border">{panel}</div>
                <Sheet open={listOpen} onOpenChange={(open) => setListChoice(open)}>
                    <SheetContent side="left" className="w-80 max-w-full p-0">
                        <SheetTitle className="sr-only">
                            {t("annotation.queueScreens.itemList")}
                        </SheetTitle>
                        <QueueItemList onOpened={() => setListChoice(false)} />
                    </SheetContent>
                </Sheet>
            </div>
        )
    }

    return (
        <div className="flex min-h-0 flex-1">
            {listOpen ? (
                <aside className="flex w-62 shrink-0 flex-col border-0 border-r border-solid border-border">
                    {list}
                </aside>
            ) : null}
            <SplitPane
                className="min-w-0 flex-1"
                paneSide="end"
                paneSize={panelWidth}
                paneMin={PANEL_MIN}
                paneMax={PANEL_MAX}
                fillMin={360}
                onResize={(size) => setPanelWidth(size)}
                onResizeEnd={(size) => writeStoredSize(PANEL_WIDTH_KEY, size)}
                pane={panel}
                fill={content}
            />
        </div>
    )
}
