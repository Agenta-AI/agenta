export const generatePaths = (obj: Record<string, any>, currentPath = "") => {
    let paths: {value: string}[] = []

    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([key, value]) => {
            const newPath = currentPath ? `${currentPath}.${key}` : key
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    } else if (Array.isArray(obj)) {
        obj.forEach((value, index) => {
            const newPath = `${currentPath}[${index}]`
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    }

    return paths
}
