import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import {Button, Checkbox, LoadingButton} from "@agenta/ui/ui"
import {CheckIcon, PencilSimpleIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {useRunReferenceLinks} from "../overview/useRunReferenceLinks"

import type {TestcaseDraft} from "./useTestcaseDraft"

/**
 * The "Test case" part of the Annotate panel: "Edit fields" makes the inputs editable in the
 * drawer, "Use this output as the reference" writes the output to the expected column, and its
 * own "Save to test set" makes a new version of the test set. The run keeps its version.
 */
export const ScenarioFocusAnnotateTestcase = ({
    draft,
    testsetName,
    version,
    expectedKey,
    onSave,
}: {
    draft: TestcaseDraft
    testsetName: string
    /** The version of the test set the run used. */
    version: number | null
    expectedKey: string | null
    onSave: () => void
}) => {
    const t = useT(annotateCatalog)
    const links = useRunReferenceLinks()
    const edited = draft.editedFields
    const saved = draft.saved
    const savedHref = saved?.revisionId ? links.testset(saved.revisionId) : null

    return (
        <section
            aria-label={t("evaluations.scenarioFocusAnnotate.testCase")}
            className="flex flex-col"
        >
            <div className="flex items-center justify-between gap-2 bg-muted px-3 py-2">
                <h3 className="m-0 text-label">
                    {t("evaluations.scenarioFocusAnnotate.testCase")}
                </h3>
                <span className="truncate text-meta text-muted-foreground">
                    {version === null
                        ? testsetName
                        : t("evaluations.scenarioFocusAnnotate.testsetVersion", {
                              testset: testsetName,
                              version,
                          })}
                </span>
            </div>
            <div className="flex flex-col gap-3 px-3 py-3">
                {expectedKey ? (
                    <label className="flex cursor-pointer items-start gap-2">
                        <Checkbox
                            className="mt-0.5"
                            checked={draft.reference}
                            disabled={!draft.ready}
                            onCheckedChange={(next) => draft.setReference(next === true)}
                        />
                        <span className="flex flex-col">
                            <span className="text-body">
                                {t("evaluations.scenarioFocusAnnotate.useOutputAsReference")}
                            </span>
                            <span className="text-meta text-muted-foreground">
                                {t("evaluations.scenarioFocusAnnotate.writesToColumn", {
                                    column: expectedKey,
                                })}
                            </span>
                        </span>
                    </label>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-body">
                        {edited.length > 0
                            ? t("evaluations.scenarioFocusAnnotate.fieldsEdited", {
                                  count: edited.length,
                                  fields: edited.join(", "),
                              })
                            : t("evaluations.scenarioFocusAnnotate.noFieldEdited")}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={draft.editing}
                        disabled={!draft.ready}
                        onClick={draft.toggleEditing}
                    >
                        <PencilSimpleIcon aria-hidden />
                        {t("evaluations.scenarioFocusAnnotate.editFields")}
                    </Button>
                </div>
                {saved ? (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                            <span className="flex items-start gap-2 text-body">
                                <CheckIcon aria-hidden className="mt-0.5 shrink-0 text-success" />
                                <span>
                                    {saved.version === null
                                        ? null
                                        : `${t("evaluations.scenarioFocusAnnotate.savedToTestset", {
                                              testset: testsetName,
                                              version: saved.version,
                                          })} `}
                                    {t("evaluations.scenarioFocusAnnotate.nextRunCanUse")}
                                </span>
                            </span>
                            {savedHref ? (
                                <Button asChild variant="ghost" size="sm">
                                    <Link href={savedHref} prefetch={false}>
                                        {t("evaluations.scenarioFocusAnnotate.openTestset")}
                                    </Link>
                                </Button>
                            ) : null}
                        </div>
                        {version === null ? null : (
                            <span className="text-meta text-muted-foreground">
                                {t("evaluations.scenarioFocusAnnotate.runKeepsVersion", {version})}
                            </span>
                        )}
                    </div>
                ) : draft.dirty ? (
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-meta text-muted-foreground">
                            {t("evaluations.scenarioFocusAnnotate.notSavedYet", {
                                testset: testsetName,
                            })}
                        </span>
                        <LoadingButton
                            variant="outline"
                            size="sm"
                            loading={draft.saving}
                            onClick={onSave}
                        >
                            {t("evaluations.scenarioFocusAnnotate.saveToTestset")}
                        </LoadingButton>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
