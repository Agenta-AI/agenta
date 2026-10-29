/** Naming rules for the Files pane's inline create / rename (pure). */

/** Why `value` can't be used as a name among `siblings`, or null. `current` is the name being
 * renamed (allowed to stay itself). */
export const validateDriveName = (
    value: string,
    siblings: string[],
    current?: string,
): string | null => {
    const v = value.trim()
    if (!v) return "Enter a name"
    if (v.includes("/")) return "A name can't contain “/”"
    if (v === "." || v === "..") return "That name isn't allowed"
    if (v !== current && siblings.includes(v)) return "Something with that name already exists here"
    return null
}

const splitExt = (name: string): [string, string] => {
    const dot = name.lastIndexOf(".")
    return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
}

/** `base` if free, else `base 2`, `base 3`… (the suffix sits before the extension). */
export const uniqueDriveName = (base: string, siblings: string[]): string => {
    if (!siblings.includes(base)) return base
    const [stem, ext] = splitExt(base)
    for (let n = 2; ; n++) {
        const candidate = `${stem} ${n}${ext}`
        if (!siblings.includes(candidate)) return candidate
    }
}

/** The default name for a new entry, unique among `siblings`. */
export const newDriveName = (kind: "folder" | "file", siblings: string[]): string =>
    uniqueDriveName(kind === "folder" ? "untitled folder" : "untitled.md", siblings)
