import {useMemo} from "react"

import {invalidateTestsetsListCache, testsetsListAtom} from "@agenta/entities/testset"
import {Alert, Button, Combobox, Input} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {CREATE_NEW, type AddToTestsetTarget} from "./useAddToTestsetForm"

/** Step 1: an existing test set to append to, or a new one and its name. */
export const TestsetTargetField = ({
    target,
    onTargetChange,
    newName,
    onNewNameChange,
}: {
    target: AddToTestsetTarget
    onTargetChange: (target: AddToTestsetTarget) => void
    newName: string
    onNewNameChange: (name: string) => void
}) => {
    const list = useAtomValue(testsetsListAtom)
    const options = useMemo(
        () => [
            {value: CREATE_NEW, label: "Create New", searchValue: "Create New"},
            ...list.data.map((testset) => ({
                value: testset.id,
                label: testset.name,
                searchValue: testset.name,
            })),
        ],
        [list.data],
    )
    const value = !target ? undefined : target.kind === "new" ? CREATE_NEW : target.testsetId

    const select = (next: string | undefined) => {
        if (!next) return onTargetChange(null)
        if (next === CREATE_NEW) return onTargetChange({kind: "new"})
        const testset = list.data.find((item) => item.id === next)
        if (testset) onTargetChange({kind: "existing", testsetId: testset.id, name: testset.name})
    }

    return (
        <section className="flex flex-col gap-2">
            <div>
                <h3 className="m-0 text-sm font-medium">1. Select test set</h3>
                <p className="text-muted-foreground m-0 text-xs">
                    Choose an existing test set to append data, or create a new one
                </p>
            </div>
            <Combobox
                aria-label="Test set"
                options={options}
                value={value}
                onChange={select}
                placeholder={list.isPending ? "Loading test sets..." : "Select test set"}
                loading={list.isPending}
                emptyText="No test sets found"
            />
            {/* A failed refresh of a list already shown is not worth an alert. */}
            {list.isError && list.data.length === 0 ? (
                <Alert
                    type="error"
                    showIcon
                    message="Couldn't load test sets"
                    action={
                        <Button variant="outline" size="sm" onClick={invalidateTestsetsListCache}>
                            Try again
                        </Button>
                    }
                />
            ) : null}
            {target?.kind === "new" ? (
                <Input
                    aria-label="Test set name"
                    placeholder="Test set name"
                    value={newName}
                    onChange={(event) => onNewNameChange(event.target.value)}
                    autoFocus
                />
            ) : null}
        </section>
    )
}
