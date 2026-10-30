/**
 * "{name} organization", the approved name for an organization's group and owner choice.
 *
 * A new organization is named "<person>'s Organization", so the plain template reads
 * "<person>'s Organization organization". A name that already ends with the word is used as is.
 */
export const organizationLabel = (name: string): string =>
    /\borganization$/i.test(name.trim()) ? name.trim() : `${name.trim()} organization`
