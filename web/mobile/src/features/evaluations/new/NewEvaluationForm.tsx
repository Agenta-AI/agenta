import {useEffect, useState, type FormEvent} from "react"

import {
    Button,
    Field,
    Input,
    LoadingButton,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"

import {useBindWorkspaceMembers} from "../../members/useBindWorkspaceMembers"

import {AdvancedSettingsSection} from "./AdvancedSettingsSection"
import {useEvaluableApps, toDraftApp} from "./appList"
import {AppSection} from "./AppSection"
import {EvaluatorsSection} from "./EvaluatorsSection"
import {
    CONCURRENCY_FIELDS,
    draftHasInput,
    type DraftRevision,
    type NewEvaluationDraft,
    type NewEvaluationKind,
    type NewEvaluationSection,
} from "./newEvaluationDraft"
import {RevisionSection} from "./RevisionSection"
import {SectionHint} from "./SectionHint"
import {StepItem, type Step} from "./StepItem"
import {TestsetSection} from "./TestsetSection"
import {useNewEvaluationDraft} from "./useNewEvaluationDraft"
import type {StartEvaluationResult} from "./useStartEvaluation"

const TITLES: Record<NewEvaluationKind, string> = {
    auto: "New Auto Evaluation",
    human: "New Human Evaluation",
}

const NEEDS_APP = "Select an application first to load this section."

/**
 * The wizard inside the sheet: the name on top, the step list on the left with a check and the
 * picks of each step, and the open step's table on the right. On a narrow screen the step list
 * sits above the table. The sheet mounts it only while open, so each open starts from an empty
 * draft. Errors keep the picks; only a confirmed close or a successful start drops them.
 */
export const NewEvaluationForm = ({
    kind,
    projectId,
    appId,
    initialRevisions,
    evaluatorsHref,
    isStarting,
    start,
    onCancel,
    onClose,
    onStarted,
    onInputChange,
    initial,
    allowAutomaticCreate = false,
}: {
    kind: NewEvaluationKind
    projectId: string
    /** The app the list is scoped to. The app step is then fixed. */
    appId: string | null
    /** Revisions the caller picked before opening, e.g. from the playground. */
    initialRevisions?: DraftRevision[]
    /** The Evaluators page, for "Create new evaluator". Null while the evaluators view is off. */
    evaluatorsHref: string | null
    isStarting: boolean
    start: (draft: NewEvaluationDraft) => Promise<StartEvaluationResult>
    /** Cancel: the sheet asks before it drops a draft with input. */
    onCancel: () => void
    /** Closes at once, after a start. */
    onClose: () => void
    onStarted: (kind: NewEvaluationKind) => void
    /** Whether the draft holds input beyond what it opened with. */
    onInputChange?: (hasInput: boolean) => void
    /** Starting values over the empty draft, for a story or a test. The sheet passes none. */
    initial?: Partial<NewEvaluationDraft>
    /** Create an automatic evaluator in the editable drawer; off inside a playground. */
    allowAutomaticCreate?: boolean
}) => {
    // Authors in the tables show by name; the playground does not bind the members itself.
    useBindWorkspaceMembers()
    // A scoped app starts the draft; its name and type arrive with the app list.
    // The draft reads its start once, when the sheet opens.
    const [opening] = useState(() => ({
        app: appId ? {id: appId, name: ""} : null,
        revisions: initialRevisions,
    }))
    const {draft, dispatch} = useNewEvaluationDraft(kind, opening, initial)
    const {apps} = useEvaluableApps()
    const scopedApp = appId ? apps.find((app) => app.id === appId) : undefined

    useEffect(() => {
        if (scopedApp) dispatch({type: "hydrateApp", app: toDraftApp(scopedApp)})
    }, [scopedApp, dispatch])

    useEffect(() => {
        onInputChange?.(draftHasInput(draft, opening))
    }, [draft, opening, onInputChange])

    const app = draft.app
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

    const settingsChips = CONCURRENCY_FIELDS.flatMap(({field}) => {
        const value = draft.concurrency[field]
        return value === null ? [] : [{id: field, label: `${field}: ${value}`}]
    })
    const steps: Step[] = [
        {
            section: "application",
            title: "Application",
            complete: app !== null,
            chips: app?.name
                ? [
                      {
                          id: app.id,
                          label: app.name,
                          onRemove: appId ? undefined : () => dispatch({type: "clearApp"}),
                      },
                  ]
                : [],
        },
        {
            section: "revision",
            title: "Revision",
            complete: draft.revisions.length > 0,
            chips: draft.revisions.map((revision) => ({
                id: revision.id,
                label: `${revision.variantName} - v${revision.version}`,
                onRemove: () => dispatch({type: "removeRevision", revisionId: revision.id}),
            })),
        },
        {
            section: "testset",
            title: "Test set",
            complete: draft.testset !== null,
            chips: draft.testset
                ? [
                      {
                          id: draft.testset.revisionId,
                          label: `${draft.testset.name} - v${draft.testset.version}`,
                          onRemove: () => dispatch({type: "clearTestset"}),
                      },
                  ]
                : [],
        },
        {
            section: "evaluators",
            title: "Evaluators",
            complete: draft.evaluators.length > 0,
            chips: draft.evaluators.map((evaluator) => ({
                id: evaluator.revisionId,
                label: `${evaluator.name} - v${evaluator.version}`,
                onRemove: () =>
                    dispatch({type: "removeEvaluator", revisionId: evaluator.revisionId}),
            })),
        },
        ...(kind === "auto"
            ? [
                  {
                      section: "settings" as const,
                      title: "Advanced Settings",
                      complete: settingsChips.length === CONCURRENCY_FIELDS.length,
                      chips: settingsChips,
                  },
              ]
            : []),
    ]
    const active = steps.find((step) => step.section === draft.section) ?? steps[0]

    const content = (() => {
        switch (active.section) {
            case "application":
                return (
                    <AppSection
                        selectedId={app?.id ?? null}
                        locked={appId !== null}
                        disabled={isStarting}
                        onPick={(next) => dispatch({type: "pickApp", app: next})}
                    />
                )
            case "revision":
                return app ? (
                    <RevisionSection
                        key={app.id}
                        kind={kind}
                        projectId={projectId}
                        appId={app.id}
                        selected={draft.revisions}
                        disabled={isStarting}
                        onPick={(revision) => dispatch({type: "pickRevision", revision})}
                    />
                ) : (
                    <SectionHint>{NEEDS_APP}</SectionHint>
                )
            case "testset":
                return app ? (
                    <TestsetSection
                        projectId={projectId}
                        revisions={draft.revisions}
                        selected={draft.testset}
                        disabled={isStarting}
                        onPick={(testset) => dispatch({type: "pickTestset", testset})}
                    />
                ) : (
                    <SectionHint>{NEEDS_APP}</SectionHint>
                )
            case "evaluators":
                return app ? (
                    <EvaluatorsSection
                        kind={kind}
                        projectId={projectId}
                        selected={draft.evaluators}
                        disabled={isStarting}
                        evaluatorsHref={evaluatorsHref}
                        onPick={(evaluator) => dispatch({type: "pickEvaluator", evaluator})}
                        allowAutomaticCreate={allowAutomaticCreate}
                    />
                ) : (
                    <SectionHint>{NEEDS_APP}</SectionHint>
                )
            case "settings":
                return (
                    <AdvancedSettingsSection
                        concurrency={draft.concurrency}
                        disabled={isStarting}
                        onChange={(field, value) =>
                            dispatch({type: "setConcurrency", field, value})
                        }
                        onReset={() => dispatch({type: "resetConcurrency"})}
                    />
                )
        }
    })()

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
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4 md:overflow-hidden">
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
                <div className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:flex-row md:gap-0">
                    <nav
                        aria-label="Steps"
                        className="md:w-60 md:shrink-0 md:overflow-y-auto md:border-0 md:border-r md:border-solid md:border-border"
                    >
                        <ol className="m-0 flex list-none flex-col gap-1 p-0">
                            {steps.map((step) => (
                                <StepItem
                                    key={step.section}
                                    step={step}
                                    active={step.section === active.section}
                                    disabled={isStarting}
                                    onOpen={open}
                                />
                            ))}
                        </ol>
                    </nav>
                    <section
                        aria-label={active.title}
                        className="min-w-0 md:flex-1 md:overflow-y-auto md:pl-6"
                    >
                        {content}
                    </section>
                </div>
            </div>
            <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" disabled={isStarting} onClick={onCancel}>
                    Cancel
                </Button>
                <LoadingButton type="submit" loading={isStarting} disabled={isStarting}>
                    Start Evaluation
                </LoadingButton>
            </SheetFooter>
        </form>
    )
}
