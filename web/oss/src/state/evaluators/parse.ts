export const parseQueries = (serialized: string) => {
    if (!serialized || serialized === "null") return undefined
    try {
        return JSON.parse(serialized) as {is_human?: boolean}
    } catch {
        return undefined
    }
}
