/** Composio names categories in lower case; acronyms stay upper case. */
const ACRONYMS = new Set(["ai", "crm", "hr", "sms", "seo", "api"])

export const categoryLabel = (name: string) =>
    name
        .split(" ")
        .map((word) =>
            ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(" ")
