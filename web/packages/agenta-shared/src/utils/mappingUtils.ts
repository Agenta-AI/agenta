/**
 * Mapping Utilities
 *
 * Pure utility functions for determining mapping status.
 * These utilities are framework-agnostic and can be used across packages.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Possible mapping status values
 */
export type MappingStatus =
    | "auto"
    | "manual"
    | "missing"
    | "invalid_path"
    | "type_mismatch"
    | "optional"

/**
 * Status configuration for UI rendering
 */
export interface MappingStatusConfig {
    status: MappingStatus
    color: "red" | "orange" | "blue" | "green" | "gray"
    label: string
    severity: "error" | "warning" | "info" | "success" | "default"
}

/**
 * Input mapping shape for status determination
 */
export interface MappingLike {
    isAutoMapped?: boolean
    status?: string
}

// ============================================================================
// STATUS DETERMINATION
// ============================================================================

/**
 * Determine the mapping status based on mapping data and requirements
 *
 * @param mapping - The mapping object (may be undefined if unmapped)
 * @param isRequired - Whether this mapping is required
 * @returns The determined mapping status
 *
 * @example
 * ```ts
 * const status = determineMappingStatus(mapping, true)
 * // Returns: 'auto' | 'manual' | 'missing' | 'invalid_path' | 'type_mismatch' | 'optional'
 * ```
 */
export function determineMappingStatus(
    mapping: MappingLike | undefined,
    isRequired: boolean,
): MappingStatus {
    if (!mapping) {
        return isRequired ? "missing" : "optional"
    }

    if (mapping.status === "missing_source") {
        return "invalid_path"
    }

    if (mapping.status === "type_mismatch") {
        return "type_mismatch"
    }

    if (mapping.isAutoMapped) {
        return "auto"
    }

    return "manual"
}

/**
 * Get the full status configuration for a mapping status
 *
 * @param status - The mapping status
 * @returns Configuration object with color, label, and severity
 *
 * @example
 * ```ts
 * const config = getMappingStatusConfig('auto')
 * // Returns: { status: 'auto', color: 'blue', label: 'Auto', severity: 'info' }
 * ```
 */
export function getMappingStatusConfig(status: MappingStatus): MappingStatusConfig {
    switch (status) {
        case "auto":
            return {status, color: "blue", label: "Auto", severity: "info"}
        case "manual":
            return {status, color: "green", label: "Manual", severity: "success"}
        case "missing":
            return {status, color: "red", label: "Missing", severity: "error"}
        case "invalid_path":
            return {status, color: "red", label: "Invalid Path", severity: "error"}
        case "type_mismatch":
            return {status, color: "orange", label: "Type Mismatch", severity: "warning"}
        case "optional":
            return {status, color: "gray", label: "Optional", severity: "default"}
        default:
            return {status: "optional", color: "gray", label: "Unknown", severity: "default"}
    }
}

/**
 * Check if a mapping status indicates an error
 */
export function isMappingError(status: MappingStatus): boolean {
    return status === "missing" || status === "invalid_path"
}

/**
 * Check if a mapping status indicates a warning
 */
export function isMappingWarning(status: MappingStatus): boolean {
    return status === "type_mismatch"
}

/**
 * Check if a mapping is complete (either auto or manual)
 */
export function isMappingComplete(status: MappingStatus): boolean {
    return status === "auto" || status === "manual"
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validation result for a set of mappings
 */
export interface MappingValidationResult {
    isValid: boolean
    isComplete: boolean
    totalMappings: number
    requiredMappings: number
    completeMappings: number
    errorCount: number
    warningCount: number
    errors: {key: string; status: MappingStatus}[]
    warnings: {key: string; status: MappingStatus}[]
}

/**
 * Validate a set of mappings against required keys
 *
 * @param mappings - Record of key to mapping object
 * @param requiredKeys - Array of keys that must be mapped
 * @returns Validation result with counts and error details
 *
 * @example
 * ```ts
 * const result = validateMappings(
 *   { input1: { isAutoMapped: true }, input2: undefined },
 *   ['input1', 'input2']
 * )
 * // Returns: { isValid: false, isComplete: false, errorCount: 1, ... }
 * ```
 */
export function validateMappings(
    mappings: Record<string, MappingLike | undefined>,
    requiredKeys: string[],
): MappingValidationResult {
    const errors: {key: string; status: MappingStatus}[] = []
    const warnings: {key: string; status: MappingStatus}[] = []
    let completeMappings = 0

    const requiredSet = new Set(requiredKeys)

    for (const [key, mapping] of Object.entries(mappings)) {
        const isRequired = requiredSet.has(key)
        const status = determineMappingStatus(mapping, isRequired)

        if (isMappingComplete(status)) {
            completeMappings++
        } else if (isMappingError(status)) {
            errors.push({key, status})
        } else if (isMappingWarning(status)) {
            warnings.push({key, status})
        }
    }

    // Also check for required keys that have no mapping at all
    for (const key of requiredKeys) {
        if (!(key in mappings)) {
            errors.push({key, status: "missing"})
        }
    }

    const isComplete = completeMappings >= requiredKeys.length
    const isValid = errors.length === 0

    return {
        isValid,
        isComplete,
        totalMappings: Object.keys(mappings).length,
        requiredMappings: requiredKeys.length,
        completeMappings,
        errorCount: errors.length,
        warningCount: warnings.length,
        errors,
        warnings,
    }
}
