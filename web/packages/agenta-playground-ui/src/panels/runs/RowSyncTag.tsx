import {useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {useT} from "@agenta/i18n"
import runsCatalog from "@agenta/i18n/catalogs/playground.runs"
import {playgroundController} from "@agenta/playground"
import {Tag} from "@agenta/ui/components/presentational"
import {X} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * Says how a test case row stands against the test set it comes from: "New" for a row added
 * after connecting, "Edited" for a changed row (the tag drops the changes), nothing for an
 * unchanged row and nothing while the playground is not connected to a test set.
 */
export const RowSyncTag = ({rowId}: {rowId: string}) => {
    const t = useT(runsCatalog)
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null
    const mode = useAtomValue(
        useMemo(() => loadableController.selectors.mode(loadableId ?? ""), [loadableId]),
    ) as "local" | "connected" | null
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(rowId), [rowId])) as boolean
    const discard = useSetAtom(testcaseMolecule.actions.discard)

    if (!loadableId || mode !== "connected") return null
    // A row added in the playground has an id that starts with "new-" or "local-".
    const isNew = rowId.startsWith("new-") || rowId.startsWith("local-")
    if (isNew) return <Tag sync="new" />
    if (!isDirty) return null
    // The discard control is a native button, so the keyboard reaches it. Preflight is off, so
    // it is reset here. The shared Tag's own dismiss is a span.
    return (
        <Tag
            sync="modified"
            label={
                <>
                    {t("playground.runs.edited")}
                    <button
                        type="button"
                        title={t("playground.runs.discardChanges")}
                        aria-label={t("playground.runs.discardChanges")}
                        className="-mr-0.5 ml-1 inline-flex cursor-pointer border-0 bg-transparent p-0 text-colorIcon"
                        onClick={() => discard(rowId)}
                    >
                        <X size={12} />
                    </button>
                </>
            }
        />
    )
}
