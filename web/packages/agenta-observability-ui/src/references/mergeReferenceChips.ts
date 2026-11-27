/**
 * One reference chip per entity, never one per field: a trace's reference keys grouped into the
 * entity they name (an application with its variant and revision, an environment, an evaluator,
 * a test case with its test set). Pure: no React, no request.
 *
 * @packageDocumentation
 */

/** One reference as a trace stores it: the key names the field, `id` or `slug` names the entity. */
export interface TraceReference {
    key?: string | null
    id?: string | null
    slug?: string | null
    version?: string | number | null
}

/** One field of a merged chip. */
export interface MergedReferenceField {
    id: string | null
    slug: string | null
    version: string | null
}

/** `testset` when the trace names a test set but no test case. */
export type MergedReferenceKind = "app" | "environment" | "evaluator" | "testcase" | "testset"

export interface MergedReferenceChip {
    kind: MergedReferenceKind
    /** The application (or workflow), environment, evaluator or test set. */
    entity: MergedReferenceField | null
    variant: MergedReferenceField | null
    /** The application, evaluator or test set revision. */
    revision: MergedReferenceField | null
    /** The test case of a `testcase` chip. */
    testcase: MergedReferenceField | null
}

type Part = "entity" | "variant" | "revision" | "testcase"
type Group = "app" | "environment" | "evaluator" | "testset"

/** Which group and which part of the chip each reference key fills. */
const KEY_PARTS: Record<string, [Group, Part]> = {
    application: ["app", "entity"],
    application_variant: ["app", "variant"],
    application_revision: ["app", "revision"],
    workflow: ["app", "entity"],
    workflow_variant: ["app", "variant"],
    workflow_revision: ["app", "revision"],
    environment: ["environment", "entity"],
    environment_variant: ["environment", "variant"],
    environment_revision: ["environment", "revision"],
    evaluator: ["evaluator", "entity"],
    evaluator_variant: ["evaluator", "variant"],
    evaluator_revision: ["evaluator", "revision"],
    testset: ["testset", "entity"],
    testset_variant: ["testset", "variant"],
    testset_revision: ["testset", "revision"],
    testcase: ["testset", "testcase"],
}

const GROUP_ORDER: Group[] = ["app", "environment", "evaluator", "testset"]

const text = (value: unknown): string | null =>
    typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null

/**
 * Group a trace's references into one chip per entity, in the order application, environment,
 * evaluator, test case. A reference with no id and no slug is left out; a group with nothing
 * left is not a chip. The first reference of each field wins.
 */
export function mergeReferenceChips(
    references: readonly TraceReference[] | null | undefined,
): MergedReferenceChip[] {
    const groups = new Map<Group, MergedReferenceChip>()
    for (const reference of references ?? []) {
        const parts = reference.key ? KEY_PARTS[reference.key] : undefined
        const id = text(reference.id)
        const slug = text(reference.slug)
        if (!parts || (!id && !slug)) continue
        const [group, part] = parts
        const chip = groups.get(group) ?? {
            kind: group,
            entity: null,
            variant: null,
            revision: null,
            testcase: null,
        }
        chip[part] ??= {id, slug, version: text(reference.version)}
        groups.set(group, chip)
    }
    return GROUP_ORDER.flatMap((group) => {
        const chip = groups.get(group)
        if (!chip) return []
        return group === "testset" && chip.testcase
            ? [{...chip, kind: "testcase" as const}]
            : [chip]
    })
}

/** The test case chip's label: the test set name and the first 6 characters of the test case id. */
export const testcaseChipLabel = (testsetName: string, testcaseId: string) =>
    `${testsetName} / ${testcaseId.slice(0, 6)}`
