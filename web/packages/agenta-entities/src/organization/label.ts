/** "{name} organization"; a name that already ends with "organization" stays as is. */
export const organizationLabel = (name: string): string =>
    /\borganization$/i.test(name.trim()) ? name.trim() : `${name.trim()} organization`
