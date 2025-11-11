// ---------------- Helpers ------------------
export const titleCase = (str: string) =>
    String(str || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[a-z]|\s[a-z]/g, (m) => m.toUpperCase())
