export const getDefaultJsonViewMode = <TMode extends string>(
    availableModes: readonly TMode[],
): TMode => {
    const hasMode = (mode: string): mode is TMode => availableModes.includes(mode as TMode)

    if (hasMode("beautified-json")) return "beautified-json"
    if (hasMode("decoded-json")) return "decoded-json"

    return (availableModes[0] ?? "json") as TMode
}
