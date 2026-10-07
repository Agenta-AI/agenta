export interface BuildKitUiState {
    enabled: boolean
    disabledOps: string[]
    permissionDefault?: "allow" | "allow_reads" | "ask"
    permissionOverrides?: Record<string, "allow" | "ask">
}

export const DEFAULT_BUILD_KIT_UI_STATE: BuildKitUiState = {enabled: true, disabledOps: []}

export function normalizeBuildKitState(entry: unknown): BuildKitUiState {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return DEFAULT_BUILD_KIT_UI_STATE
    const {enabled, disabledOps, permissionDefault, permissionOverrides} = entry as BuildKitUiState
    return {
        enabled: typeof enabled === "boolean" ? enabled : true,
        disabledOps: Array.isArray(disabledOps)
            ? disabledOps.filter((op): op is string => typeof op === "string")
            : [],
        ...(permissionDefault === "allow" ||
        permissionDefault === "ask" ||
        permissionDefault === "allow_reads"
            ? {permissionDefault}
            : {}),
        ...(permissionOverrides &&
        typeof permissionOverrides === "object" &&
        !Array.isArray(permissionOverrides)
            ? {
                  permissionOverrides: Object.fromEntries(
                      Object.entries(permissionOverrides).filter(
                          ([, value]) => value === "allow" || value === "ask",
                      ),
                  ),
              }
            : {}),
    }
}

export function buildKitDefaultPermission(
    state: BuildKitUiState,
    readOnly: boolean,
): "allow" | "ask" {
    return state.permissionDefault === "ask" ||
        (state.permissionDefault === "allow_reads" && !readOnly)
        ? "ask"
        : "allow"
}

export function resolveBuildKitPermissions(
    overlay: Record<string, unknown> | null,
    state: BuildKitUiState,
): Record<string, "allow" | "ask"> {
    const access = (overlay?.op_access ?? {}) as Record<string, unknown>
    return Object.fromEntries(
        (Array.isArray(overlay?.tools) ? overlay.tools : []).flatMap((tool) => {
            if (
                !tool ||
                typeof tool !== "object" ||
                tool.type !== "platform" ||
                typeof tool.op !== "string" ||
                state.disabledOps.includes(tool.op)
            )
                return []
            return [
                [
                    tool.op,
                    state.permissionOverrides?.[tool.op] ??
                        buildKitDefaultPermission(state, access[tool.op] === "read"),
                ],
            ]
        }),
    )
}
