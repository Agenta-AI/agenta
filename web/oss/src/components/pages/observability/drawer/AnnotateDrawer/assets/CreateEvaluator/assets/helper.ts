export function slugify(text: string) {
    return text
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-]+/g, "-") // Replace invalid chars with dash
        .replace(/\-+/g, "-") // Collapse multiple dashes
        .replace(/^\-+|\-+$/g, "") // Trim dashes
}
