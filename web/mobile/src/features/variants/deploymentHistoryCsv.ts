import type {AppDeploymentRow} from "@agenta/entities/environment"

import {variantLabel} from "./deploymentVariantLabel"

/** One CSV cell: quoted, and a leading = + - or @ made inert so a sheet does not run it. */
const cell = (value: string | number | null | undefined): string => {
    const text = value == null ? "" : String(value)
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
}

/** The deployment history rows as CSV, with the columns the table shows. */
export const deploymentHistoryCsv = (
    rows: readonly AppDeploymentRow[],
    variantNames: ReadonlyMap<string, string>,
    authorNames: ReadonlyMap<string, string>,
): string => {
    const header = ["Revision", "Variant", "Version", "Notes", "Date modified", "Modified by"]
    const lines = rows.map((row) =>
        [
            `v${row.index}`,
            variantLabel(row, variantNames),
            row.deployedRevisionVersion != null ? `v${row.deployedRevisionVersion}` : "",
            row.message ?? "",
            row.createdAt ?? "",
            (row.authorId ? authorNames.get(row.authorId) : null) ?? row.authorId ?? "",
        ]
            .map(cell)
            .join(","),
    )
    return [header.map(cell).join(","), ...lines].join("\n")
}
