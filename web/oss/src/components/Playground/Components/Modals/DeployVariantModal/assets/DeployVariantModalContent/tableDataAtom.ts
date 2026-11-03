import deepEqual from "fast-deep-equal"
import {selectAtom} from "jotai/utils"

import {appEnvironmentsLoadableAtom} from "@/oss/state/environment/appEnvironmentAtoms"

// Row shape strictly needed by the table
export interface DeployModalEnvRow {
    name: string
    deployedAppVariantRevisionId?: string | null
    deployedVariantName?: string | null
}

const PLACEHOLDER_ROWS: DeployModalEnvRow[] = [{name: "dev"}, {name: "stage"}, {name: "prod"}]

export interface DeployModalEnvironmentsTable {
    rows: DeployModalEnvRow[]
    /**
     * True while the environments query has not produced rows yet, so `rows` are the
     * placeholders. The table MUST render its skeleton (not the rows) while this is set:
     * a placeholder row is not a real deployment target and must not be selectable.
     * A settled-but-empty result is NOT pending — it keeps today's placeholder rows.
     */
    isPending: boolean
}

// Lean selector for the Deploy Variant modal table
// - Only exposes fields used by the table
// - Bakes in placeholders when environments are loading or empty
export const deployModalEnvironmentsTableAtom = selectAtom(
    appEnvironmentsLoadableAtom,
    (loadable): DeployModalEnvironmentsTable => {
        const isLoading = loadable?.isLoading ?? loadable?.isFetching
        const envs = Array.isArray(loadable?.data) ? loadable.data : null
        const isPending = Boolean(isLoading) || envs === null

        if (isPending || envs === null || envs.length === 0) {
            return {rows: PLACEHOLDER_ROWS, isPending}
        }

        return {
            rows: envs.map((e) => ({
                name: e.name,
                deployedAppVariantRevisionId: e.deployedRevisionId ?? null,
                deployedVariantName: e.deployedVariantName ?? null,
            })) as DeployModalEnvRow[],
            isPending: false,
        }
    },
    deepEqual,
)
