import {useState} from "react"

import {NameDialog} from "../../settings/NameDialog"

import {defaultCloneName} from "./cloneName"
import {useTestsetNameActions} from "./useTestsetNameActions"

/** The test set a name dialog acts on. */
export interface TestsetNameTarget {
    id: string
    name: string
}

/**
 * One name field for cloning or renaming a test set. A clone starts as "{name} (copy)", or "(copy 2)" and up when that name is taken. A failed
 * save keeps the dialog open with the typed name and says why.
 */
export const TestsetNameDialog = ({
    mode,
    testset,
    projectId,
    base,
    takenSlugs = [],
    onClose,
}: {
    mode: "clone" | "rename"
    testset: TestsetNameTarget
    projectId: string
    base: string
    /** The slugs of the test sets that exist, so a clone starts with a name that is free. */
    takenSlugs?: readonly string[]
    onClose: () => void
}) => {
    const {clone, rename} = useTestsetNameActions({projectId, base})
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const isClone = mode === "clone"
    // Fixed when the dialog opens, so a list refresh does not change the name under the reader.
    const [initialName] = useState(() =>
        isClone ? defaultCloneName(testset.name, takenSlugs) : testset.name,
    )

    const submit = async (name: string) => {
        // A rename to the same name has nothing to save.
        if (!isClone && name === testset.name) {
            onClose()
            return
        }
        setPending(true)
        setError(null)
        try {
            await (isClone ? clone(testset, name) : rename(testset, name))
            onClose()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : null)
        } finally {
            setPending(false)
        }
    }

    return (
        <NameDialog
            open
            title={isClone ? "Clone test set" : "Rename test set"}
            submitLabel={isClone ? "Clone" : "Rename"}
            pending={pending}
            initialValue={initialName}
            placeholder="Enter a name"
            error={error}
            // A save that is running keeps the dialog open, so its result lands where the reader is looking.
            onClose={() => (pending ? undefined : onClose())}
            onSubmit={(name) => void submit(name)}
        />
    )
}
