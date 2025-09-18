import deepEqual from "fast-deep-equal"
import {selectAtom} from "jotai/utils"

import {environmentsLoadableAtom} from "@/oss/state/environment/atoms/fetcher"

// Row shape strictly needed by the table
export interface DeployModalEnvRow {
    name: string
    deployedAppVariantRevisionId?: string | null
}

const PLACEHOLDER_ROWS: DeployModalEnvRow[] = [{name: "dev"}, {name: "stage"}, {name: "prod"}]

// Lean selector for the Deploy Variant modal table
// - Only exposes fields used by the table
// - Bakes in placeholders when environments are loading or empty
export const deployModalEnvironmentsTableAtom = selectAtom(
    environmentsLoadableAtom,
    (loadable: any) => {
        const isLoading = loadable?.isLoading ?? loadable?.isFetching
        const envs = loadable?.data ?? null

        if (isLoading || !Array.isArray(envs) || envs.length === 0) {
            return PLACEHOLDER_ROWS
        }

        return (envs as any[]).map((e) => ({
            name: e?.name,
            deployedAppVariantRevisionId: e?.deployedAppVariantRevisionId ?? null,
        })) as DeployModalEnvRow[]
    },
    deepEqual,
)
