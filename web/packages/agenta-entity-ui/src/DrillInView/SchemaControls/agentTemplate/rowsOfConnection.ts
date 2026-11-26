import type {AgentConnectionNamespace} from "@agenta/entities/secret"

import type {PickerConnectionRow} from "../connectionPicker"
import type {ConnectionMode} from "../connectionUtils"

/**
 * The picker rows of the stored connection only, so a fix lists the models the chosen key offers.
 * All rows when none matches: an empty menu would leave no way out.
 */
export const rowsOfConnection = (
    rows: PickerConnectionRow[],
    current: {
        mode: ConnectionMode
        slug: string | null
        namespace: AgentConnectionNamespace | null
    },
): PickerConnectionRow[] => {
    const matching = rows.filter((row) =>
        row.models.some(
            (model) =>
                model.mode === current.mode &&
                (model.slug ?? null) === (current.slug ?? null) &&
                (!current.namespace || model.namespace === current.namespace),
        ),
    )
    return matching.length ? matching : rows
}
