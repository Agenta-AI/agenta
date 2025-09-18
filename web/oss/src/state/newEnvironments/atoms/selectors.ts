/**
 * Environment Selector Atoms
 *
 * UI-focused selector atoms for:
 * - Environment dropdowns and pickers
 * - Selected environment state management
 * - Quick lookup maps and utilities
 * - Interactive environment switching
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithStorage} from "jotai/utils"

import {Environment} from "@/oss/lib/Types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

import {environmentsAtom, environmentsLoadingAtom} from "./environments"

// ============================================================================
// Selector Types
// ============================================================================

export interface EnvironmentSelectorOption {
    value: string // environment name
    label: string // display name
    isDeployed: boolean
    deployedVariant: string | null
    disabled?: boolean
}

export interface EnvironmentSelectorState {
    options: EnvironmentSelectorOption[]
    selectedValue: string | null
    hasSelection: boolean
    loading: boolean
    isEmpty: boolean
    deployedOptions: EnvironmentSelectorOption[]
    emptyOptions: EnvironmentSelectorOption[]
}

// ============================================================================
// Storage Atoms
// ============================================================================

/**
 * Persisted selected environment per app
 * Stored as: { [appId]: environmentName }
 */
const selectedEnvironmentStorageAtom = atomWithStorage<Record<string, string>>(
    "agenta:selectedEnvironments",
    {},
)

// ============================================================================
// Selector Option Transformation
// ============================================================================

/**
 * Transform environment into selector option
 */
const transformToSelectorOption = (env: Environment): EnvironmentSelectorOption => ({
    value: env.name,
    label: env.name,
    isDeployed: !!(env.deployed_app_variant_id && env.deployed_variant_name),
    deployedVariant: env.deployed_variant_name,
    disabled: false,
})

// ============================================================================
// Core Selector Atoms
// ============================================================================

/**
 * Environment selector options atom
 * Transforms environments into dropdown-friendly options
 */
export const environmentSelectorOptionsAtom = selectAtom(
    environmentsAtom,
    (environments): EnvironmentSelectorOption[] => environments.map(transformToSelectorOption),
    deepEqual,
)

/**
 * Selected environment name atom (per app)
 */
export const selectedEnvironmentNameAtom = atom<string | null>(
    (get) => {
        const appId = get(selectedAppIdAtom)
        const storage = get(selectedEnvironmentStorageAtom)
        return appId ? storage[appId] || null : null
    },
    (get, set, newValue: string | null) => {
        const appId = get(selectedAppIdAtom)
        if (!appId) return

        const storage = get(selectedEnvironmentStorageAtom)
        const updated = {...storage}

        if (newValue) {
            updated[appId] = newValue
        } else {
            delete updated[appId]
        }

        set(selectedEnvironmentStorageAtom, updated)
    },
)

/**
 * Selected environment object atom
 */
export const selectedEnvironmentAtom = selectAtom(
    atom((get) => ({
        environments: get(environmentsAtom),
        selectedName: get(selectedEnvironmentNameAtom),
    })),
    ({environments, selectedName}): Environment | null => {
        if (!selectedName) return null
        return environments.find((env) => env.name === selectedName) || null
    },
    deepEqual,
)

/**
 * Complete selector state atom
 */
export const environmentSelectorStateAtom = atom<EnvironmentSelectorState>((get) => {
    const options = get(environmentSelectorOptionsAtom)
    const selectedValue = get(selectedEnvironmentNameAtom)
    const loading = get(environmentsLoadingAtom)

    const deployedOptions = options.filter((opt) => opt.isDeployed)
    const emptyOptions = options.filter((opt) => !opt.isDeployed)

    return {
        options,
        selectedValue,
        hasSelection: !!selectedValue,
        loading,
        isEmpty: options.length === 0,
        deployedOptions,
        emptyOptions,
    }
})

// ============================================================================
// Lookup Maps
// ============================================================================

/**
 * Environment lookup map by name
 */
export const environmentMapAtom = selectAtom(
    environmentsAtom,
    (environments): Record<string, Environment> => {
        const map: Record<string, Environment> = {}
        environments.forEach((env) => {
            map[env.name] = env
        })
        return map
    },
    deepEqual,
)

/**
 * Environment lookup map by app ID
 */
export const environmentsByAppAtom = selectAtom(
    environmentsAtom,
    (environments): Record<string, Environment[]> => {
        const map: Record<string, Environment[]> = {}
        environments.forEach((env) => {
            if (!map[env.app_id]) {
                map[env.app_id] = []
            }
            map[env.app_id].push(env)
        })
        return map
    },
    deepEqual,
)

/**
 * Deployed environments map (name -> deployed variant info)
 */
export const deployedEnvironmentMapAtom = selectAtom(
    environmentsAtom,
    (
        environments,
    ): Record<
        string,
        {
            variantId: string
            variantName: string
            revisionId: string | null
            revision: string | null
        }
    > => {
        const map: Record<string, any> = {}
        environments.forEach((env) => {
            if (env.deployed_app_variant_id && env.deployed_variant_name) {
                map[env.name] = {
                    variantId: env.deployed_app_variant_id,
                    variantName: env.deployed_variant_name,
                    revisionId: env.deployed_app_variant_revision_id,
                    revision: env.revision,
                }
            }
        })
        return map
    },
    deepEqual,
)

// ============================================================================
// Utility Selector Atoms
// ============================================================================

/**
 * Environment names array for quick iteration
 */
export const environmentNamesAtom = selectAtom(
    environmentsAtom,
    (environments) => environments.map((env) => env.name),
    deepEqual,
)

/**
 * Deployed environment names only
 */
export const deployedEnvironmentNamesAtom = selectAtom(
    environmentsAtom,
    (environments) =>
        environments
            .filter((env) => env.deployed_app_variant_id && env.deployed_variant_name)
            .map((env) => env.name),
    deepEqual,
)

/**
 * Empty environment names only
 */
export const emptyEnvironmentNamesAtom = selectAtom(
    environmentsAtom,
    (environments) =>
        environments
            .filter((env) => !env.deployed_app_variant_id || !env.deployed_variant_name)
            .map((env) => env.name),
    deepEqual,
)

/**
 * Auto-select first environment if none selected
 */
export const autoSelectedEnvironmentAtom = atom<Environment | null>((get) => {
    const selected = get(selectedEnvironmentAtom)
    if (selected) return selected

    const environments = get(environmentsAtom)
    if (environments.length === 0) return null

    // Prefer deployed environments for auto-selection
    const deployed = environments.find(
        (env) => env.deployed_app_variant_id && env.deployed_variant_name,
    )

    return deployed || environments[0] || null
})

/**
 * Environment selector validation
 */
export const environmentSelectorValidationAtom = selectAtom(
    environmentSelectorStateAtom,
    (state) => ({
        isValid: state.hasSelection && !state.loading,
        hasOptions: !state.isEmpty,
        needsSelection: !state.hasSelection && !state.isEmpty,
        isLoading: state.loading,
        error: state.isEmpty && !state.loading ? "No environments available" : null,
    }),
    deepEqual,
)
