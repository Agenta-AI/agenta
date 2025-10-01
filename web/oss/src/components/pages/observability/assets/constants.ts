import {
    MagnifyingGlass,
    Timer,
    TreeStructure,
    HashStraight,
    IdentificationBadge,
    TextT,
    CurrencyDollarSimple,
    Coins,
    WarningCircle,
    WarningOctagon,
    BracketsCurly,
    PencilSimple,
    TagSimple,
    Lightning,
    BookmarkSimple,
    StackSimple,
    Download,
    Gear,
    LineSegments,
    Sparkle,
    TreeView,
    ChatText,
    Gauge,
    CirclesFour,
    PlusCircle,
} from "@phosphor-icons/react"
import {SpanCategory} from "@/oss/services/tracing/types"
import {FilterMenuNode} from "@/oss/components/Filters/Filters"
import {FilterConditions} from "@/oss/lib/Types"

const COLLECTION_MEMBERSHIP_OPS: Array<{value: FilterConditions; label: string}> = [
    {value: "in", label: "in"},
    {value: "not_in", label: "not in"},
]

const STRING_EQU_OPS: Array<{value: FilterConditions; label: string}> = [
    {value: "is", label: "is"},
    {value: "is_not", label: "is not"},
]

const STRING_EQU_AND_CONTAINS_OPS: Array<{value: FilterConditions; label: string}> = [
    ...STRING_EQU_OPS,
    ...COLLECTION_MEMBERSHIP_OPS,
]

const EXISTS_OPS: Array<{value: FilterConditions; label: string}> = [
    {value: "exists", label: "exists"},
    {value: "not_exists", label: "not exists"},
]

const STRING_SEARCH_OPS: Array<{value: FilterConditions; label: string}> = [
    {value: "contains", label: "contains"},
    {value: "startswith", label: "starts with"},
    {value: "endswith", label: "ends with"},
    // {value: "matches", label: "matches"},
    // {value: "like", label: "like"},
]

const NUM_OPS: Array<{value: FilterConditions; label: string}> = [
    {value: "eq", label: "="},
    {value: "neq", label: "!="},
    {value: "gt", label: ">"},
    {value: "lt", label: "<"},
    {value: "gte", label: ">="},
    {value: "lte", label: "<="},
    {value: "btwn", label: "between"},
]

export const FILTER_COLUMNS: FilterMenuNode[] = [
    {
        kind: "group",
        label: "Trace",
        icon: TreeView,
        children: [
            {
                kind: "leaf",
                field: "trace_id",
                type: "exists",
                value: "trace_id",
                label: "ID",
                displayLabel: "Trace ID",
                icon: HashStraight,
                operatorOptions: STRING_EQU_AND_CONTAINS_OPS,
            },
            {
                kind: "leaf",
                field: "trace_type",
                type: "exists",
                value: "trace_type",
                label: "Type",
                displayLabel: "Trace Type",
                icon: TagSimple,
                operatorOptions: STRING_EQU_AND_CONTAINS_OPS,
                valueInput: {
                    kind: "select",
                    options: [
                        {label: "Invocation", value: "invocation"},
                        {label: "Annotation", value: "annotation"},
                    ],
                },
            },
        ],
    },
    {
        kind: "group",
        label: "Span",
        icon: Sparkle,
        defaultValue: "span_id",
        children: [
            {
                kind: "leaf",
                field: "span_id",
                type: "exists",
                value: "span_id",
                label: "ID",
                displayLabel: "Span ID",
                icon: HashStraight,
                operatorOptions: STRING_EQU_AND_CONTAINS_OPS,
            },
            {
                kind: "leaf",
                field: "span_type",
                type: "exists",
                value: "span_type",
                label: "Type",
                displayLabel: "Span Type",
                icon: TagSimple,
                operatorOptions: STRING_EQU_AND_CONTAINS_OPS,
                valueInput: {
                    kind: "select",
                    options: [
                        {label: "chat", value: "chat"},
                        {label: "agent", value: "agent"},
                        {label: "workflow", value: "workflow"},
                        {label: "chain", value: "chain"},
                        {label: "task", value: "task"},
                        {label: "tool", value: "tool"},
                        {label: "embedding", value: "embedding"},
                        {label: "query", value: "query"},
                        {label: "rerank", value: "rerank"},
                        {label: "llm", value: "llm"},
                    ],
                },
            },
            {
                kind: "leaf",
                field: "span_name",
                type: "exists",
                value: "span_name",
                label: "Name",
                displayLabel: "Span Name",
                icon: IdentificationBadge,
                operatorOptions: STRING_EQU_AND_CONTAINS_OPS,
            },
        ],
    },
    {
        kind: "leaf",
        label: "Duration (ms)",
        icon: Timer,
        field: "attributes.ag.metrics.duration.cumulative",
        type: "number",
        value: "attributes.ag.metrics.duration.cumulative",
        operatorOptions: NUM_OPS,
    },
    {
        kind: "group",
        label: "Cost ($)",
        icon: Coins,
        defaultValue: "attributes.ag.metrics.costs.cumulative.total",
        titleClickDisplayLabel: "Total Cost",
        children: [
            {
                kind: "group",
                label: "Completion",
                defaultValue: "attributes.ag.metrics.costs.cumulative.completion",
                leafDisplayLabel: "Completion Cost",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.cumulative.completion",
                        type: "number",
                        value: "attributes.ag.metrics.costs.cumulative.completion",
                        label: "Aggregate",
                        displayLabel: "Total Completion Cost",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.incremental.completion",
                        type: "number",
                        value: "attributes.ag.metrics.costs.incremental.completion",
                        label: "Span",
                        displayLabel: "Total Completion Cost (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
            {
                kind: "group",
                label: "Prompt",
                defaultValue: "attributes.ag.metrics.costs.cumulative.prompt",
                leafDisplayLabel: "Prompt Cost",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.cumulative.prompt",
                        type: "number",
                        value: "attributes.ag.metrics.costs.cumulative.prompt",
                        label: "Aggregate",
                        displayLabel: "Total Prompt Cost",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.incremental.prompt",
                        type: "number",
                        value: "attributes.ag.metrics.costs.incremental.prompt",
                        label: "Span",
                        displayLabel: "Total Prompt Cost (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
            {
                kind: "group",
                defaultValue: "attributes.ag.metrics.costs.cumulative.total",
                leafDisplayLabel: "Total Cost",
                label: "Total",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.cumulative.total",
                        type: "number",
                        value: "attributes.ag.metrics.costs.cumulative.total",
                        label: "Aggregate",
                        displayLabel: "Total Cost",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.costs.incremental.total",
                        type: "number",
                        value: "attributes.ag.metrics.costs.incremental.total",
                        label: "Span",
                        displayLabel: "Total Cost (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
        ],
    },
    {
        kind: "group",
        label: "Tokens",
        icon: PlusCircle,
        defaultValue: "attributes.ag.metrics.tokens.cumulative.total",
        titleClickDisplayLabel: "Total Tokens",
        children: [
            {
                kind: "group",
                label: "Completion",
                defaultValue: "attributes.ag.metrics.tokens.cumulative.completion",
                leafDisplayLabel: "Completion Tokens",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.cumulative.completion",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.cumulative.completion",
                        label: "Aggregate",
                        displayLabel: "Total Completion Tokens",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.incremental.completion",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.incremental.completion",
                        label: "Span",
                        displayLabel: "Total Completion Tokens (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
            {
                kind: "group",
                label: "Prompt",
                defaultValue: "attributes.ag.metrics.tokens.cumulative.prompt",
                leafDisplayLabel: "Prompt Tokens",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.cumulative.prompt",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.cumulative.prompt",
                        label: "Aggregate",
                        displayLabel: "Total Prompt Tokens",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.incremental.prompt",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.incremental.prompt",
                        label: "Span",
                        displayLabel: "Total Prompt Tokens (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
            {
                kind: "group",
                defaultValue: "attributes.ag.metrics.tokens.cumulative.total",
                leafDisplayLabel: "Total Tokens",
                label: "Total",
                children: [
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.cumulative.total",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.cumulative.total",
                        label: "Aggregate",
                        displayLabel: "Total Tokens",
                        operatorOptions: NUM_OPS,
                    },
                    {
                        kind: "leaf",
                        field: "attributes.ag.metrics.tokens.incremental.total",
                        type: "number",
                        value: "attributes.ag.metrics.tokens.incremental.total",
                        label: "Span",
                        displayLabel: "Total Tokens (Span)",
                        operatorOptions: NUM_OPS,
                    },
                ],
            },
        ],
    },
    {
        kind: "group",
        label: "Status",
        icon: Gauge,
        children: [
            {
                kind: "leaf",
                field: "status_code",
                type: "string",
                value: "status_code",
                label: "Code",
                displayLabel: "Status Code",
                icon: BracketsCurly,
                operatorOptions: STRING_EQU_OPS,
                valueInput: {
                    kind: "select",
                    options: [
                        {label: "Success", value: "STATUS_CODE_OK"},
                        {label: "Failure", value: "STATUS_CODE_ERROR"},
                    ],
                },
            },
            {
                kind: "leaf",
                field: "status_message",
                type: "string",
                value: "status_message",
                label: "Message",
                displayLabel: "Status Message",
                icon: ChatText,
                operatorOptions: STRING_SEARCH_OPS,
                valueInput: {kind: "text", placeholder: "Enter message…"},
            },
        ],
    },
    {
        kind: "leaf",
        label: "Exception",
        icon: WarningOctagon,
        type: "exists",
        value: "events",
        field: "events",
        operatorOptions: [
            {value: "in", label: "exists"},
            {value: "not_in", label: "not exists"},
        ],
        defaultValue: [{name: "exception"}],
        disableValueInput: true,
        valueDisplayText: "exception",
    },
    // {
    //     kind: "leaf",
    //     field: "annotation",
    //     type: "exists",
    //     value: "annotation",
    //     label: "Annotation",
    //     icon: PencilSimple,
    // },
    // Tags -> my_tag + IS + blue
    // attributes + ag.tags.my_tag + IS + blue
    // {kind: "leaf", field: "tags", type: "exists", value: "tags", label: "Tags", icon: TagSimple},
    {
        kind: "group",
        label: "Reference",
        icon: Lightning,
        children: [
            {
                kind: "leaf",
                field: "references",
                type: "exists",
                value: "id",
                label: "ID",
                displayLabel: "Reference ID",
                icon: HashStraight,
                operatorOptions: [
                    {value: "in", label: "is"},
                    {value: "not_in", label: "is not"},
                ],
            },
            // {
            //     kind: "leaf",
            //     field: "references",
            //     type: "exists",
            //     value: "slug",
            //     label: "Slug",
            //     displayLabel: "Reference Slug",
            //     icon: BookmarkSimple,
            //     operatorOptions: [
            //         {value: "in", label: "is"},
            //         {value: "not_in", label: "is not"},
            //     ],
            // },
            {
                kind: "leaf",
                field: "references",
                type: "exists",
                value: "version",
                label: "Version",
                displayLabel: "Reference Version",
                icon: StackSimple,
                operatorOptions: [
                    {value: "in", label: "is"},
                    {value: "not_in", label: "is not"},
                ],
            },
        ],
    },
]

export const spanTypeStyles = {
    [SpanCategory.AGENT]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [SpanCategory.WORKFLOW]: {
        color: "#586673",
        bgColor: "#F5F7FA",
        icon: TreeStructure,
    },
    [SpanCategory.CHAIN]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [SpanCategory.TASK]: {
        bgColor: "#EAEFF5",
        color: "#586673",
        icon: TreeStructure,
    },
    [SpanCategory.TOOL]: {
        bgColor: "#F9F0FF",
        color: "#9254DE",
        icon: Download,
    },
    [SpanCategory.EMBEDDING]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [SpanCategory.COMPLETION]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [SpanCategory.QUERY]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [SpanCategory.CHAT]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [SpanCategory.RERANK]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [SpanCategory.LLM]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [SpanCategory.UNDEFINED]: {
        bgColor: "#F5F7FA",
        color: "#586673",
        icon: TreeStructure,
    },
}
