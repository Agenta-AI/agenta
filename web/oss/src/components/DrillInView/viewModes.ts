export const getDefaultJsonViewMode = <TMode extends string>(
    availableModes: readonly TMode[],
): TMode => {
    const hasMode = (mode: string): mode is TMode => availableModes.includes(mode as TMode)

    // Guard narrows an identifier, not a literal — bind first so the return is typed TMode.
    const prettyJson = "pretty-json"
    if (hasMode(prettyJson)) return prettyJson
    const decodedJson = "decoded-json"
    if (hasMode(decodedJson)) return decodedJson

    return (availableModes[0] ?? "json") as TMode
}
