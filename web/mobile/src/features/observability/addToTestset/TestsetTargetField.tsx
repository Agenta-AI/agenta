import {useMemo} from "react"

import {invalidateTestsetsListCache, testsetsListAtom} from "@agenta/entities/testset"
import {formatLocale, useT} from "@agenta/i18n"
import addToTestsetCatalog from "@agenta/i18n/catalogs/observability.addToTestset"
import {Alert, Button, Combobox, Input} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {
    CREATE_NEW,
    type AddToTestsetTarget,
    type TestsetRevisionOption,
} from "./useAddToTestsetForm"

const revisionLabel = (revision: TestsetRevisionOption, latestLabel: string | null) => {
    const date = revision.createdAt
        ? new Date(revision.createdAt).toLocaleDateString(formatLocale())
        : null
    return [`v${revision.version}`, date, latestLabel].filter(Boolean).join(" · ")
}

/**
 * Step 1: an existing test set to append to, and its revision (the latest by default), or a new
 * test set and its name.
 */
export const TestsetTargetField = ({
    target,
    onTargetChange,
    revisions,
    newName,
    onNewNameChange,
}: {
    target: AddToTestsetTarget
    onTargetChange: (target: AddToTestsetTarget) => void
    revisions: {
        status: "idle" | "loading" | "error" | "ready"
        options: readonly TestsetRevisionOption[]
        retry: () => void
    }
    newName: string
    onNewNameChange: (name: string) => void
}) => {
    const t = useT(addToTestsetCatalog)
    const list = useAtomValue(testsetsListAtom)
    const testsetOptions = useMemo(
        () =>
            list.data.map((testset) => ({
                value: testset.id,
                label: testset.name,
                searchValue: testset.name,
            })),
        [list.data],
    )
    const createNewLabel = t("observability.addToTestset.createNew")
    const options = [
        {value: CREATE_NEW, label: createNewLabel, searchValue: createNewLabel},
        ...testsetOptions,
    ]
    const value = !target ? undefined : target.kind === "new" ? CREATE_NEW : target.testsetId

    const select = (next: string | undefined) => {
        if (!next) return onTargetChange(null)
        if (next === CREATE_NEW) return onTargetChange({kind: "new"})
        const testset = list.data.find((item) => item.id === next)
        if (testset) {
            onTargetChange({
                kind: "existing",
                testsetId: testset.id,
                name: testset.name,
                revisionId: null,
            })
        }
    }

    const latestId = revisions.options[0]?.id
    const revisionOptions = revisions.options.map((revision) => {
        const label = revisionLabel(
            revision,
            revision.id === latestId ? t("observability.addToTestset.latest") : null,
        )
        return {value: revision.id, label, searchValue: label}
    })
    const selectRevision = (next: string | undefined) => {
        if (target?.kind !== "existing" || !next) return
        // The latest stays "latest", so a commit made meanwhile is still the base at save time.
        onTargetChange({...target, revisionId: next === latestId ? null : next})
    }

    return (
        <section className="flex flex-col gap-2">
            <div>
                <h3 className="m-0 text-sm font-medium">
                    {t("observability.addToTestset.step1Title")}
                </h3>
                <p className="text-muted-foreground m-0 text-xs">
                    {t("observability.addToTestset.step1Hint")}
                </p>
            </div>
            <Combobox
                aria-label={t("observability.addToTestset.testSet")}
                options={options}
                value={value}
                onChange={select}
                placeholder={
                    list.isPending
                        ? t("observability.addToTestset.loadingTestSets")
                        : t("observability.addToTestset.selectTestSet")
                }
                loading={list.isPending}
                emptyText={t("observability.addToTestset.noTestSets")}
            />
            {/* A failed refresh of a list already shown is not worth an alert. */}
            {list.isError && list.data.length === 0 ? (
                <Alert
                    type="error"
                    showIcon
                    message={t("observability.addToTestset.couldNotLoadTestSets")}
                    action={
                        <Button variant="outline" size="sm" onClick={invalidateTestsetsListCache}>
                            {t("observability.addToTestset.tryAgain")}
                        </Button>
                    }
                />
            ) : null}
            {target?.kind === "new" ? (
                <Input
                    aria-label={t("observability.addToTestset.testSetName")}
                    placeholder={t("observability.addToTestset.testSetName")}
                    value={newName}
                    onChange={(event) => onNewNameChange(event.target.value)}
                    autoFocus
                />
            ) : null}
            {target?.kind === "existing" ? (
                revisions.status === "error" ? (
                    <Alert
                        type="error"
                        showIcon
                        message={t("observability.addToTestset.couldNotLoadRevisions")}
                        action={
                            <Button variant="outline" size="sm" onClick={revisions.retry}>
                                {t("observability.addToTestset.tryAgain")}
                            </Button>
                        }
                    />
                ) : (
                    <Combobox
                        aria-label={t("observability.addToTestset.revision")}
                        options={revisionOptions}
                        value={target.revisionId ?? latestId}
                        onChange={selectRevision}
                        placeholder={
                            revisions.status === "loading"
                                ? t("observability.addToTestset.loadingRevisions")
                                : t("observability.addToTestset.selectRevision")
                        }
                        loading={revisions.status === "loading"}
                        emptyText={t("observability.addToTestset.noRevisions")}
                    />
                )
            ) : null}
        </section>
    )
}
