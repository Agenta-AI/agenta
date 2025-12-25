const splitPath = (path: string) => path.split(/(?<!\\)\./g).map((p) => p.replace(/\\\./g, "."))

export const getValueAtPath = (obj: any, rawPath: string) => {
    if (obj == null || !rawPath) return undefined

    // quick direct hit (entire path is a literal key on the current object)
    if (Object.prototype.hasOwnProperty.call(obj, rawPath)) return obj[rawPath]

    const parts = splitPath(rawPath)
    let cur: any = obj

    for (let i = 0; i < parts.length; i++) {
        if (cur == null) return undefined

        const key = parts[i]

        if (Object.prototype.hasOwnProperty.call(cur, key)) {
            cur = cur[key]
            continue
        }

        // fallback: treat the remaining segments as one literal key containing dots
        const remainder = parts.slice(i).join(".")
        if (Object.prototype.hasOwnProperty.call(cur, remainder)) {
            return cur[remainder]
        }

        return undefined
    }

    return cur
}
