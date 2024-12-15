export const accessKeyInVariant = (path: string, object: Record<string, any>): any => {
    return path.split(".").reduce((o, i) => o[i], object)
}
