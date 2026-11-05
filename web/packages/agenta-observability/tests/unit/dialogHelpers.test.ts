import {describe, expect, it} from "vitest"

import {
    buildFieldMenuItems,
    buildKeyTreeData,
    collapseAnnotationAnyEvaluatorRowsFromProps,
    createEmptyFilter,
    effectiveFieldForRow,
    explodeAnnotationAnyEvaluatorRows,
    extractAnnotationValue,
    filtersEqual,
    findIncompleteIsAnnotationFilter,
    mapFilterData,
    mapToTreeData,
    normalizeAttributeSearch,
    resolveFieldForFilter,
    sanitizeFilterItems,
    selectSendableRows,
    validateFilterRow,
    type FilterFieldMap,
} from "../../src/filters/dialogHelpers"
import type {FieldConfig} from "../../src/filters/fieldAdapter"
import {FILTER_COLUMNS} from "../../src/filters/filterColumns"
import type {FilterGroup, FilterItem, FilterLeaf, FilterMenuNode} from "../../src/filters/types"

const fc = (over: Partial<FieldConfig>): FieldConfig => ({
    optionKey: "x",
    baseField: "x",
    label: "X",
    type: "string",
    operatorIds: ["is"],
    keyInput: {kind: "none"},
    valueInput: {kind: "text"},
    ...over,
})

const mapOf = (...configs: FieldConfig[]): FilterFieldMap =>
    new Map(configs.map((config) => [config.optionKey, config]))

const leaf = (over: Partial<FilterLeaf> & {label: string; value: string}): FilterLeaf => ({
    kind: "leaf",
    field: over.value,
    type: "string",
    ...over,
})

describe("extractAnnotationValue", () => {
    it("reads the evaluator/feedback object out of a single-element array", () => {
        expect(extractAnnotationValue([{evaluator: "e1", feedback: {field: "score"}}])).toEqual({
            evaluator: "e1",
            feedback: {field: "score"},
        })
    })

    it("keeps an explicitly-absent evaluator distinguishable from a missing one", () => {
        expect(extractAnnotationValue([{evaluator: undefined}])).toEqual({evaluator: undefined})
        expect(extractAnnotationValue([{}])).toBeUndefined()
    })

    it("returns undefined for non-annotation values", () => {
        expect(extractAnnotationValue("abc")).toBeUndefined()
        expect(extractAnnotationValue([])).toBeUndefined()
        expect(extractAnnotationValue(["a"])).toBeUndefined()
        expect(extractAnnotationValue([["a"]])).toBeUndefined()
    })
})

describe("collapse / explode annotation any-evaluator rows", () => {
    const ANNOTATION = fc({optionKey: "has_annotation", baseField: "annotation", label: "Feedback"})
    const getField = (uiKey?: string) => (uiKey === "has_annotation" ? ANNOTATION : undefined)

    const row = (field: string): FilterItem => ({
        field: "has_annotation",
        selectedField: "has_annotation",
        baseField: "annotation",
        key: "",
        operator: "is",
        value: [{feedback: {field, operator: "is", value: "", valueType: "string"}}],
    })

    it("merges rows that differ only by feedback.field into one array-valued row", () => {
        const out = collapseAnnotationAnyEvaluatorRowsFromProps(
            [row("accuracy"), row("tone")],
            getField,
        )
        expect(out).toHaveLength(1)
        expect(extractAnnotationValue(out[0].value)?.feedback?.field).toEqual(["accuracy", "tone"])
    })

    it("round-trips back to one row per feedback key", () => {
        const collapsed = collapseAnnotationAnyEvaluatorRowsFromProps(
            [row("accuracy"), row("tone")],
            getField,
        )
        const exploded = explodeAnnotationAnyEvaluatorRows(collapsed)
        expect(exploded).toHaveLength(2)
        expect(exploded.map((r) => extractAnnotationValue(r.value)?.feedback?.field)).toEqual([
            "accuracy",
            "tone",
        ])
    })

    it("leaves evaluator-scoped rows alone", () => {
        const scoped: FilterItem = {
            ...row("accuracy"),
            value: [{evaluator: "e1", feedback: {field: "accuracy"}}],
        }
        expect(
            collapseAnnotationAnyEvaluatorRowsFromProps([scoped, scoped], getField),
        ).toHaveLength(2)
        expect(explodeAnnotationAnyEvaluatorRows([scoped])).toHaveLength(1)
    })

    it("passes non-annotation rows through unchanged and in order", () => {
        const plain: FilterItem = {field: "status", key: "", operator: "is", value: "ok"}
        const out = collapseAnnotationAnyEvaluatorRowsFromProps([plain, row("tone")], getField)
        expect(out).toHaveLength(2)
        expect(out[0]).toBe(plain)
    })
})

describe("buildFieldMenuItems", () => {
    const IconA = () => null
    const columns: FilterMenuNode[] = [
        leaf({label: "Status", value: "status"}),
        {
            kind: "group",
            label: "References",
            children: [
                leaf({label: "Application ID", value: "application.id"}),
                leaf({label: "Evaluator ID", value: "evaluator.id"}),
            ],
        } as FilterGroup,
    ]

    it("descends groups and keeps leaf option keys as the commit value", () => {
        const entries = buildFieldMenuItems(columns)
        expect(entries[0]).toMatchObject({kind: "leaf", key: "status", disabled: false})
        const group = entries[1]
        if (group.kind !== "group") throw new Error("expected a group")
        expect(group.children.map((child) => child.key)).toEqual(["application.id", "evaluator.id"])
        // The header commits the group's first leaf (antd `onTitleClick`).
        expect(group.defaultValue).toBe("application.id")
    })

    it("marks disabled option keys, on leaves and on group headers", () => {
        const entries = buildFieldMenuItems(columns, {
            disabledOptionKeys: new Set(["status", "application.id"]),
        })
        expect(entries[0]).toMatchObject({disabled: true})
        const group = entries[1]
        if (group.kind !== "group") throw new Error("expected a group")
        expect(group.defaultDisabled).toBe(true)
        expect(group.children[0]).toMatchObject({disabled: true})
    })

    it("falls back to the host icon map by label when a node carries no icon", () => {
        const entries = buildFieldMenuItems(columns, {icons: {Status: IconA}})
        expect(entries[0].icon).toBe(IconA)
    })

    it("gives nested groups distinct render keys", () => {
        const nested: FilterMenuNode[] = [
            {kind: "group", label: "A", children: [leaf({label: "L", value: "l"})]} as FilterGroup,
            {kind: "group", label: "B", children: [leaf({label: "M", value: "m"})]} as FilterGroup,
        ]
        const [a, b] = buildFieldMenuItems(nested)
        expect(a.key).not.toBe(b.key)
    })
})

describe("buildKeyTreeData", () => {
    const options = [
        {
            label: "ag",
            value: "attributes.ag",
            children: [{label: "cost", value: "attributes.ag.cost"}],
        },
    ]

    it("maps options to the tree shape, keeping the dotted path as search and display label", () => {
        const [root] = mapToTreeData(options)
        expect(root).toMatchObject({value: "attributes.ag", label: "ag", searchLabel: "ag"})
        expect(root.children?.[0]).toMatchObject({
            value: "attributes.ag.cost",
            searchLabel: "ag.cost",
            displayLabel: "ag.cost",
        })
    })

    it("injects a synthetic node for a search term that no option matches", () => {
        const tree = buildKeyTreeData(options, "ag.missing", undefined)
        expect(tree[0]).toMatchObject({value: "attributes.ag.missing", label: "ag.missing"})
        expect(tree).toHaveLength(2)
    })

    it("injects a node for a committed key that is absent from the options", () => {
        const tree = buildKeyTreeData(options, undefined, "attributes.custom.key")
        expect(tree[0].value).toBe("attributes.custom.key")
    })

    it("does not duplicate a key that the search term already produced", () => {
        const tree = buildKeyTreeData(options, "ag.missing", "attributes.ag.missing")
        expect(tree.filter((node) => node.value === "attributes.ag.missing")).toHaveLength(1)
    })

    it("adds nothing when the key is already an option", () => {
        expect(buildKeyTreeData(options, undefined, "attributes.ag.cost")).toHaveLength(1)
    })
})

describe("normalizeAttributeSearch with a tree path", () => {
    const INPUTS = "ag.data.inputs"
    const OUTPUTS = "ag.data.outputs"

    it("reads a bare input key below the inputs path", () => {
        expect(normalizeAttributeSearch("country", INPUTS)).toEqual({
            value: "attributes.ag.data.inputs.country",
            pathLabel: "ag.data.inputs.country",
        })
    })

    it("reads a bare output key below the outputs path", () => {
        expect(normalizeAttributeSearch(" score ", OUTPUTS)?.value).toBe(
            "attributes.ag.data.outputs.score",
        )
    })

    it("keeps the dots of a nested key", () => {
        expect(normalizeAttributeSearch("question.text", INPUTS)?.value).toBe(
            "attributes.ag.data.inputs.question.text",
        )
        expect(normalizeAttributeSearch("inputs.question.text", INPUTS)?.value).toBe(
            "attributes.ag.data.inputs.inputs.question.text",
        )
    })

    it("leaves a full path unchanged", () => {
        expect(normalizeAttributeSearch("attributes.ag.data.inputs.country", INPUTS)?.value).toBe(
            "attributes.ag.data.inputs.country",
        )
        expect(normalizeAttributeSearch("ag.data.inputs.country", INPUTS)?.value).toBe(
            "attributes.ag.data.inputs.country",
        )
    })

    it("keeps today's behavior without a tree path (the Custom field)", () => {
        expect(normalizeAttributeSearch("ag.tags.env")?.value).toBe("attributes.ag.tags.env")
        expect(normalizeAttributeSearch("env")?.value).toBe("env")
        expect(normalizeAttributeSearch("   ")).toBeUndefined()
    })

    it("uses the tree paths of the Input Key and Output Key columns", () => {
        const treePaths = Object.fromEntries(
            FILTER_COLUMNS.filter(
                (node): node is FilterLeaf =>
                    node.kind === "leaf" &&
                    (node.field === "input_keys" || node.field === "output_keys"),
            ).map((node) => [
                node.field,
                node.keyInput?.kind === "select" ? node.keyInput.treePath : undefined,
            ]),
        )
        expect(treePaths).toEqual({input_keys: INPUTS, output_keys: OUTPUTS})
    })

    it("builds the typed node of the key tree with the full path", () => {
        const tree = buildKeyTreeData([], "country", undefined, INPUTS)
        expect(tree).toHaveLength(1)
        expect(tree[0]).toMatchObject({
            value: "attributes.ag.data.inputs.country",
            label: "ag.data.inputs.country",
        })
    })
})

describe("sanitizeFilterItems for a key below a tree path", () => {
    const INPUT_KEY = fc({
        optionKey: "input_keys",
        baseField: "input_keys",
        label: "Input Key",
        operatorIds: ["is"],
        keyInput: {
            kind: "select",
            options: [],
            usesAttributeKeyTree: true,
            treePath: "ag.data.inputs",
        },
    })
    const row = (key: string): FilterItem => ({
        ...createEmptyFilter(),
        field: "input_keys",
        selectedField: "input_keys",
        key,
        operator: "is",
        value: "Japan",
    })

    it("sends the full path for a bare key saved before the fix", () => {
        const [filter] = sanitizeFilterItems([row("country")], mapOf(INPUT_KEY))
        expect(filter).toMatchObject({
            field: "input_keys",
            key: "attributes.ag.data.inputs.country",
            value: "Japan",
        })
    })

    it("keeps a full path unchanged", () => {
        const [filter] = sanitizeFilterItems(
            [row("attributes.ag.data.inputs.country")],
            mapOf(INPUT_KEY),
        )
        expect(filter.key).toBe("attributes.ag.data.inputs.country")
    })
})

describe("findIncompleteIsAnnotationFilter", () => {
    const MESSAGE = "Pick an evaluator or a feedback for the Is Annotation filter."
    const isAnnotation = (value: unknown) => ({
        field: "is_annotation",
        operator: "in" as const,
        value: value as FilterItem["value"],
    })

    it("names the row in plain words when it has neither an evaluator nor a feedback", () => {
        expect(findIncompleteIsAnnotationFilter([isAnnotation([])])).toBe(MESSAGE)
        expect(findIncompleteIsAnnotationFilter([isAnnotation([{}])])).toBe(MESSAGE)
        expect(
            findIncompleteIsAnnotationFilter([isAnnotation([{feedback: {valueType: "string"}}])]),
        ).toBe(MESSAGE)
        expect(MESSAGE).not.toMatch(/is_annotation/)
    })

    it("accepts a row with an evaluator or a feedback field", () => {
        expect(findIncompleteIsAnnotationFilter([isAnnotation([{evaluator: "judge"}])])).toBe(
            undefined,
        )
        expect(
            findIncompleteIsAnnotationFilter([isAnnotation([{feedback: {field: ["score"]}}])]),
        ).toBe(undefined)
    })

    it("ignores other rows", () => {
        expect(
            findIncompleteIsAnnotationFilter([
                {field: "has_annotation", operator: "in", value: []},
            ]),
        ).toBe(undefined)
    })
})

describe("resolveFieldForFilter", () => {
    const APP = fc({
        optionKey: "application.id",
        baseField: "references",
        referenceCategory: "application",
        referenceProperty: "id",
    })
    const EVALUATOR = fc({
        optionKey: "evaluator.id",
        baseField: "references",
        referenceCategory: "evaluator",
        referenceProperty: "id",
    })
    const map = mapOf(APP, EVALUATOR)

    it("prefers an exact option-key hit", () => {
        expect(resolveFieldForFilter({field: "evaluator.id", operator: "is", value: ""}, map)).toBe(
            EVALUATOR,
        )
    })

    it("disambiguates the references family by attributes.key", () => {
        const resolved = resolveFieldForFilter(
            {
                field: "references",
                operator: "in",
                value: [{"attributes.key": "evaluator", id: "abc"}],
            },
            map,
        )
        expect(resolved).toBe(EVALUATOR)
    })

    it("falls back to the first reference-property match", () => {
        const resolved = resolveFieldForFilter(
            {field: "references", operator: "in", value: [{id: "abc"}]},
            map,
        )
        expect(resolved).toBe(APP)
    })
})

describe("mapFilterData / sanitizeFilterItems", () => {
    const STATUS = fc({
        optionKey: "status",
        baseField: "status",
        label: "Status",
        valueInput: {kind: "select", options: [{label: "ok", value: "ok"}]},
        operatorIds: ["is"],
    })
    const CUSTOM = fc({optionKey: "custom", baseField: "custom", label: "Custom", queryKey: ""})
    const map = mapOf(STATUS, CUSTOM)

    it("annotates incoming filters with the resolved column", () => {
        const [row] = mapFilterData([{field: "status", operator: "is", value: "ok"}], map)
        expect(row).toMatchObject({
            field: "status",
            selectedField: "status",
            baseField: "status",
            selectedLabel: "Status",
            isCustomField: false,
        })
    })

    it("treats an unresolvable field as a custom key", () => {
        const [row] = mapFilterData([{field: "attributes.foo", operator: "is", value: "1"}], map)
        expect(row).toMatchObject({isCustomField: true, selectedField: "__custom__"})
    })

    it("round-trips a known field back to its base field", () => {
        const rows = mapFilterData([{field: "status", operator: "is", value: "ok"}], map)
        expect(sanitizeFilterItems(rows, map)).toEqual([
            {field: "status", operator: "is", value: "ok"},
        ])
    })

    it("coerces the custom field by its per-row value type", () => {
        const row: FilterItem = {
            field: "custom",
            selectedField: "custom",
            key: "attributes.n",
            operator: "eq",
            value: "42",
            customValueType: "number",
        }
        expect(sanitizeFilterItems([row], map)[0].value).toBe(42)
    })

    it("keeps isPermanent on the way out", () => {
        const row: FilterItem = {
            field: "status",
            selectedField: "status",
            operator: "is",
            value: "ok",
            isPermanent: true,
        }
        expect(sanitizeFilterItems([row], map)[0].isPermanent).toBe(true)
    })
})

describe("selectSendableRows", () => {
    it("drops rows with no operator but keeps permanent ones", () => {
        const rows: FilterItem[] = [
            {field: "status", operator: "", value: ""},
            {field: "", operator: "", value: "", isPermanent: true},
            {field: "status", operator: "is", value: "ok"},
        ]
        expect(selectSendableRows(rows)).toHaveLength(2)
    })
})

describe("validateFilterRow", () => {
    const TEXT = fc({optionKey: "name", baseField: "name", operatorIds: ["is", "in"]})
    const NUMBER = fc({
        optionKey: "cost",
        baseField: "cost",
        type: "number",
        operatorIds: ["gt", "between"],
    })
    const NEEDS_KEY = fc({
        optionKey: "attr",
        baseField: "attributes",
        keyInput: {kind: "select", options: []},
        operatorIds: ["is"],
    })
    const EXISTS = fc({
        optionKey: "events",
        baseField: "events",
        type: "exists",
        operatorIds: ["exists"],
    })
    const map = mapOf(TEXT, NUMBER, NEEDS_KEY, EXISTS)

    const check = (item: FilterItem) => validateFilterRow(item, map)

    it("passes permanent rows unconditionally", () => {
        expect(check({field: "", operator: "", value: "", isPermanent: true}).isValid).toBe(true)
    })

    it("requires a field, an operator and a value", () => {
        expect(check({field: "", operator: "", value: ""}).isValid).toBe(false)
        expect(
            check({field: "name", selectedField: "name", operator: "", value: "x"}).isValid,
        ).toBe(false)
        expect(
            check({field: "name", selectedField: "name", operator: "is", value: ""}).isValid,
        ).toBe(false)
        expect(
            check({field: "name", selectedField: "name", operator: "is", value: "x"}).isValid,
        ).toBe(true)
    })

    it("requires the key when the field has a key input", () => {
        expect(
            check({field: "attr", selectedField: "attr", operator: "is", value: "x"}).isValid,
        ).toBe(false)
        expect(
            check({
                field: "attr",
                selectedField: "attr",
                key: "attributes.a",
                operator: "is",
                value: "x",
            }).isValid,
        ).toBe(true)
    })

    it("skips the value check when the operator hides it", () => {
        expect(
            check({field: "events", selectedField: "events", operator: "exists", value: ""})
                .isValid,
        ).toBe(true)
    })

    it("flags a non-numeric value on a numeric field", () => {
        expect(check({field: "cost", selectedField: "cost", operator: "gt", value: "abc"})).toEqual(
            {isValid: false, valueInvalid: true},
        )
    })

    // The range branch is unreachable today: no registry operator declares
    // `valueShape: "range"` (`between`/`btwn` are in the FilterConditions union but absent
    // from OPERATORS, so `getOperator` returns undefined and any row using one throws).
    // Left untested rather than tested through an operator that cannot exist.

    it("rejects an empty list", () => {
        expect(
            check({field: "name", selectedField: "name", operator: "in", value: []}).isValid,
        ).toBe(false)
    })
})

describe("effectiveFieldForRow", () => {
    it("derives the custom field's operators and value input from the row's value type", () => {
        const CUSTOM = fc({optionKey: "custom", baseField: "custom"})
        const row: FilterItem = {
            field: "custom",
            operator: "",
            value: "",
            customValueType: "boolean",
        }
        const effective = effectiveFieldForRow(CUSTOM, row)
        expect(effective?.operatorIds).toEqual(["is", "is_not"])
        expect(effective?.valueInput?.kind).toBe("select")
    })

    it("returns non-custom fields untouched", () => {
        const STATUS = fc({optionKey: "status"})
        expect(effectiveFieldForRow(STATUS, createEmptyFilter())).toBe(STATUS)
    })
})

describe("filtersEqual", () => {
    it("matches lodash isEqual's undefined semantics", () => {
        expect(filtersEqual([], undefined)).toBe(false)
        expect(filtersEqual(undefined, undefined)).toBe(true)
        expect(filtersEqual([], [])).toBe(true)
    })

    it("compares nested filter values structurally", () => {
        expect(
            filtersEqual(
                [{field: "a", operator: "in", value: [{id: "1"}]}],
                [{field: "a", operator: "in", value: [{id: "1"}]}],
            ),
        ).toBe(true)
        expect(
            filtersEqual(
                [{field: "a", operator: "in", value: [{id: "1"}]}],
                [{field: "a", operator: "in", value: [{id: "2"}]}],
            ),
        ).toBe(false)
    })
})
