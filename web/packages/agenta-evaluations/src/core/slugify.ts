/**
 * Deterministic slug builder — combines a sanitized kebab-cased `name` with the
 * last 12 chars of `id`. Identical to the backend implementation, so the step
 * keys it produces are reproducible and match what the server expects.
 *
 * NOTE: this is a verbatim port of `web/oss/src/lib/utils/slugify.ts`. It is
 * intentionally NOT `@agenta/shared`'s `slugifyName`/`generateSlugWithSuffix`,
 * which append a RANDOM suffix — run step keys must be deterministic.
 *
 * TODO(T5 / consolidation): promote this deterministic variant into
 * `@agenta/shared/utils/slug.ts` (e.g. `slugifyWithId`) and have both the OSS
 * `slugify.ts` and this module re-export it, instead of holding two copies.
 */
export const slugify = (name: string, id: string): string => {
    const normalized = name
        ?.normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "-")

    const suffix = id?.slice(-12) || ""
    return `${normalized}-${suffix}`
}
