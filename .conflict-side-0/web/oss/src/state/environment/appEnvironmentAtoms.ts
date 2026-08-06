/**
 * App Environment Deployment Atoms (OSS)
 *
 * Thin wrappers that resolve the current appId from the router/app state
 * and delegate to the parameterized atom families in @agenta/entities/environment.
 *
 * Enriches variant names by resolving them from workflow variant entities,
 * since stored environment references may contain auto-generated hex slugs
 * instead of human-readable variant names.
 */

import {
    appEnvironmentsQueryAtomFamily,
    appEnvironmentsAtomFamily,
    appEnvironmentsLoadableAtomFamily,
    type AppEnvironmentDeployment,
} from "@agenta/entities/environment"
import {workflowVariantsListDataAtomFamily} from "@agenta/entities/workflow"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {routerAppIdAtom, currentAppAtom} from "@/oss/state/app/selectors/app"

// ============================================================================
// RESOLVED APP ID
// ============================================================================

const resolvedAppIdAtom = atom((get) => {
    return get(routerAppIdAtom) || get(currentAppAtom)?.id || ""
})

// ============================================================================
// VARIANT NAME RESOLUTION
// ============================================================================

/**
 * Build a map of variantId → human-readable name from the workflow variants list.
 * Used to replace auto-generated hex slugs in environment references.
 */
export const variantNameMapAtom = atom((get) => {
    const appId = get(resolvedAppIdAtom)
    if (!appId) return null
    const variants = get(workflowVariantsListDataAtomFamily(appId))
    if (!variants.length) return null
    const map = new Map<string, string>()
    for (const v of variants) {
        if (v.id && v.name) map.set(v.id, v.name)
    }
    return map.size > 0 ? map : null
})

function enrichVariantName(
    env: AppEnvironmentDeployment,
    nameMap: Map<string, string> | null,
): AppEnvironmentDeployment {
    if (!nameMap || !env.deployedVariantId) return env
    const resolvedName = nameMap.get(env.deployedVariantId)
    if (!resolvedName || resolvedName === env.deployedVariantName) return env
    return {...env, deployedVariantName: resolvedName}
}

// ============================================================================
// OSS CONVENIENCE ATOMS (resolve appId automatically)
// ============================================================================

export const appEnvironmentsQueryAtom = atom((get) => {
    const appId = get(resolvedAppIdAtom)
    return get(appEnvironmentsQueryAtomFamily(appId))
})

const rawAppEnvironmentsAtom = atom((get) => {
    const appId = get(resolvedAppIdAtom)
    return get(appEnvironmentsAtomFamily(appId))
})

export const appEnvironmentsAtom = selectAtom(
    atom((get) => {
        const envs = get(rawAppEnvironmentsAtom)
        const nameMap = get(variantNameMapAtom)
        if (!nameMap || !envs?.length) return envs
        return envs.map((env) => enrichVariantName(env, nameMap))
    }),
    (v) => v,
    deepEqual,
)

export const appEnvironmentsLoadableAtom = atom((get) => {
    const appId = get(resolvedAppIdAtom)
    const loadable = get(appEnvironmentsLoadableAtomFamily(appId))
    const nameMap = get(variantNameMapAtom)
    if (!nameMap || !loadable?.data?.length) return loadable
    return {
        ...loadable,
        data: loadable.data.map((env) => enrichVariantName(env, nameMap)),
    }
})
