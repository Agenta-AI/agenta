import {useEffect, type FormEvent} from "react"

import {
    Accordion,
    Button,
    Field,
    Input,
    LoadingButton,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"

import {AdvancedSettingsSection} from "./AdvancedSettingsSection"
import {useEvaluableApps, toDraftApp} from "./appList"
import {AppSection} from "./AppSection"
import {EvaluatorsSection} from "./EvaluatorsSection"
import {
    CONCURRENCY_FIELDS,
    type DraftRevision,
    type NewEvaluationDraft,
    type NewEvaluationKind,
    type NewEvaluationSection,
} from "./newEvaluationDraft"
import {RevisionSection} from "./RevisionSection"
import {SectionItem, type SectionChip} from "./SectionItem"
import {TestsetSection} from "./TestsetSection"
import {useNewEvaluationDraft} from "./useNewEvaluationDraft"
import type {StartEvaluationResult} from "./useStartEvaluation"

const TITLES: Record<NewEvaluationKind, string> = {
    auto: "New Auto Evaluation",
    human: "New Human Evaluation",
}

/**
 * The wizard inside the sheet. The sheet mounts it only while open, so each open starts from an
 * empty draft. Errors keep the picks; only Cancel or a successful start drops them.
 */
export const NewEvaluationForm = ({
    kind,
    appId,
    initialRevisions,
    evaluatorsHref,
    isStarting,
    start,
    onClose,
    onStarted,
    initial,
}: {
    kind: NewEvaluationKind
    /** The app the list is scoped to. The app section is then fixed. */
    appId: string | null
    /** Revisions the caller picked before opening, e.g. from the playground. */
    initialRevisions?: DraftRevision[]
    /** Where "Open evaluators" goes. Null while the evaluators view is off. */
    evaluatorsHref: string | null
    isStarting: boolean
    start: (draft: NewEvaluationDraft) => Promise<StartEvaluationResult>
    onClose: () => void
    onStarted: (kind: NewEvaluationKind) => void
    /** Starting values over the empty draft, for a story or a test. The sheet passes none. */
    initial?: Partial<NewEvaluationDraft>
}) => {
    const {draft, dispatch} = useNewEvaluationDraft(
        kind,
        {
            // A scoped app starts the draft; its name and type arrive with the app list.
            app: appId ? {id: appId, name: "", isCustom: false} : null,
            revisions: initialRevisions,
        },
        initial,
    )
    const {apps} = useEvaluableApps()
    const scopedApp = appId ? apps.find((app) => app.id === appId) : undefined

    useEffect(() => {
        if (scopedApp) dispatch({type: "hydrateApp", app: toDraftApp(scopedApp)})
    }, [scopedApp, dispatch])

    const appChosen = draft.app !== null
    const open = (section: NewEvaluationSection) => dispatch({type: "openSection", section})

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        const result = await start(draft)
        if (result.status === "invalid") open(result.section)
        if (result.status === "started") {
            onStarted(result.kind)
            onClose()
        }
    }

    const appChips: SectionChip[] = draft.app?.name
        ? [
              {
                  id: draft.app.id,
                  label: draft.app.name,
                  onRemove: appId ? undefined : () => dispatch({type: "clearApp"}),
              },
          ]
        : []
    const revisionChips: SectionChip[] = draft.revisions.map((revision) => ({
        id: revision.id,
        label: `${revision.variantName} - v${revision.version}`,
        onRemove: () => dispatch({type: "removeRevision", revisionId: revision.id}),
    }))
    const testsetChips: SectionChip[] = draft.testset
        ? [
              {
                  id: draft.testset.revisionId,
                  label: `${draft.testset.name} - v${draft.testset.version}`,
                  onRemove: () => dispatch({type: "clearTestset"}),
              },
          ]
        : []
    const evaluatorChips: SectionChip[] = draft.evaluators.map((evaluator) => ({
        id: evaluator.revisionId,
        label: `${evaluator.name} - v${evaluator.version}`,
        onRemove: () => dispatch({type: "removeEvaluator", revisionId: evaluator.revisionId}),
    }))
    const settingsChips: SectionChip[] = CONCURRENCY_FIELDS.flatMap(({field}) => {
        const value = draft.concurrency[field]
        return value === null ? [] : [{id: field, label: `${field}: ${value}`}]
    })

    return (
        <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            aria-label={TITLES[kind]}
            className="flex min-h-0 flex-1 flex-col"
        >
            <SheetHeader showCloseButton={!isStarting}>
                <SheetTitle>{TITLES[kind]}</SheetTitle>
                <SheetDescription className="sr-only">
                    Name the evaluation, then pick the app, revisions, test set and evaluators.
                </SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <Field label="Evaluation name" required>
                    <Input
                        autoFocus
                        value={draft.name}
                        placeholder="Enter a name"
                        disabled={isStarting}
                        onChange={(event) => dispatch({type: "setName", name: event.target.value})}
                        onBlur={() => dispatch({type: "blurName"})}
                    />
                </Field>
                <Accordion
                    type="single"
                    collapsible
                    value={draft.section}
                    onValueChange={(next) => next && open(next as NewEvaluationSection)}
                >
                    <SectionItem
                        value="application"
                        title="Application"
                        chips={appChips}
                        disabled={isStarting}
                    >
                        <AppSection
                            selectedId={draft.app?.id ?? null}
                            disabled={isStarting || appId !== null}
                            onPick={(app) => dispatch({type: "pickApp", app})}
                        />
                    </SectionItem>
                    <SectionItem
                        value="revision"
                        title="Revision"
                        chips={revisionChips}
                        disabled={isStarting}
                    >
                        <RevisionSection
                            kind={kind}
                            appId={draft.app?.id ?? null}
                            selected={draft.revisions}
                            disabled={isStarting}
                            onPick={(revision) => dispatch({type: "pickRevision", revision})}
                            onRemove={(revisionId) =>
                                dispatch({type: "removeRevision", revisionId})
                            }
                        />
                    </SectionItem>
                    <SectionItem
                        value="testset"
                        title="Test set"
                        chips={testsetChips}
                        disabled={isStarting}
                    >
                        <TestsetSection
                            hasApp={appChosen}
                            revisions={draft.revisions}
                            selected={draft.testset}
                            disabled={isStarting}
                            onPick={(testset) => dispatch({type: "pickTestset", testset})}
                        />
                    </SectionItem>
                    <SectionItem
                        value="evaluators"
                        title="Evaluators"
                        chips={evaluatorChips}
                        disabled={isStarting}
                    >
                        <EvaluatorsSection
                            kind={kind}
                            hasApp={appChosen}
                            selected={draft.evaluators}
                            disabled={isStarting}
                            evaluatorsHref={evaluatorsHref}
                            onPick={(evaluator) => dispatch({type: "pickEvaluator", evaluator})}
                            onRemove={(revisionId) =>
                                dispatch({type: "removeEvaluator", revisionId})
                            }
                            onClear={() => dispatch({type: "clearEvaluators"})}
                        />
                    </SectionItem>
                    {kind === "auto" ? (
                        <SectionItem
                            value="settings"
                            title="Advanced Settings"
                            chips={settingsChips}
                            complete={settingsChips.length === CONCURRENCY_FIELDS.length}
                            disabled={isStarting}
                        >
                            <AdvancedSettingsSection
                                concurrency={draft.concurrency}
                                disabled={isStarting}
                                onChange={(field, value) =>
                                    dispatch({type: "setConcurrency", field, value})
                                }
                                onReset={() => dispatch({type: "resetConcurrency"})}
                            />
                        </SectionItem>
                    ) : null}
                </Accordion>
                {!appChosen ? (
                    <p className="m-0 text-sm text-muted-foreground">
                        Please select an application to continue configuring the evaluation.
                    </p>
                ) : null}
            </div>
            <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" disabled={isStarting} onClick={onClose}>
                    Cancel
                </Button>
                <LoadingButton type="submit" loading={isStarting} disabled={isStarting}>
                    Start Evaluation
                </LoadingButton>
            </SheetFooter>
        </form>
    )
}
