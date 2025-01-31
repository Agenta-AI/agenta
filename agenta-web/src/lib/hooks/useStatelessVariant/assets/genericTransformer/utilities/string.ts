/** String manipulation utilities */
export const toCamelCase = (str: string): string =>
    str.replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace(/[-_]/g, ""))

export const toSnakeCase = (str: string): string =>
    str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export const generateId = () => crypto.randomUUID()
