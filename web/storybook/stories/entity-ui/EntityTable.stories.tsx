import {testcaseDataController, type TestcaseDataConfig} from "@agenta/entities/testcase"
import {EntityTable} from "@agenta/entity-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * EntityTable — the generic entity list (controller-driven, rendered by the
 * InfiniteVirtualTable shell). The migration swapped the selection column's antd
 * `Checkbox`/`Radio` for the `@agenta/ui` `Checkbox` and a per-row single-item
 * `RadioGroup` — multi-select shows checkboxes + a select-all header (indeterminate
 * while partially selected), single-select shows radios and no header control.
 *
 * Data comes through the controller's LOCAL mode (`useLocal` + `localRows` +
 * `getCellValue`), the same public config `TestcaseTable` uses — no product code is
 * mocked and no query fixtures are needed. The controller's selection/rows atom
 * families are keyed by `scopeId`/config, both story-scoped via `scope.id(…)`; the
 * fixture objects are cached per scope so the config's reference equality
 * (`areConfigsEqual` compares `localRows` by reference) holds across renders.
 */
const meta = {
    title: "@agenta/entity-ui/Shared/EntityTable",
    component: EntityTable,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Generic entity table with optional selection. antd `Checkbox`/`Radio` in the selection column → `@agenta/ui` `Checkbox`/`RadioGroup`.",
            },
        },
    },
} satisfies Meta<typeof EntityTable>

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Per-scope fixture cache — args() runs on every decorator render, and the
// controller's atomFamily compares `localRows` by reference, so the same objects
// must be returned every time for a given story.
// ---------------------------------------------------------------------------

interface TableFixture {
    config: TestcaseDataConfig
    getRowData: (record: {id: string}) => Record<string, unknown> | null
    getCellValue: (record: {id: string}, columnKey: string) => unknown
}

const COLUMNS = ["input", "expected_output", "score"]

const fixtureCache = new Map<string, TableFixture>()

function tableFixture(scope: StoryScope, scopeName: string): TableFixture {
    const cacheKey = `${scope.key}:${scopeName}`
    const cached = fixtureCache.get(cacheKey)
    if (cached) return cached

    const data: Record<string, Record<string, unknown>> = {}
    const localRows = Array.from({length: 6}, (_, i) => {
        const id = scope.id(`row-${scopeName}-${i}`)
        data[id] = {
            input: `What is ${i + 2} + ${i + 3}?`,
            expected_output: String(2 * i + 5),
            score: Math.round((0.6 + i * 0.07) * 100) / 100,
        }
        return {id, data: data[id]}
    })

    const fixture: TableFixture = {
        config: {
            scopeId: scope.id(`table-${scopeName}`),
            useLocal: true,
            localRows,
            localColumnKeys: COLUMNS,
        },
        getRowData: (record) => data[record.id] ?? null,
        getCellValue: (record, columnKey) => data[record.id]?.[columnKey],
    }
    fixtureCache.set(cacheKey, fixture)
    return fixture
}

const tableArgs = (scopeName: string, extra: Record<string, unknown> = {}) => {
    return (scope: StoryScope) => {
        const fixture = tableFixture(scope, scopeName)
        return {
            controller: testcaseDataController,
            config: fixture.config,
            getRowData: fixture.getRowData,
            getCellValue: fixture.getCellValue,
            ...extra,
        }
    }
}

const Frame = (StoryComponent: React.ComponentType) => (
    <div style={{height: 360}} className="w-full">
        <StoryComponent />
    </div>
)

/** Multi-select: checkbox rows + select-all header (indeterminate when partial). */
export const MultiSelect: Story = {
    args: {controller: testcaseDataController, config: {scopeId: "placeholder"}},
    decorators: [Frame],
    parameters: {
        agenta: {
            args: tableArgs("multi", {selectable: true}),
        },
    },
}

/** Single-select: one radio per row, no select-all header. */
export const SingleSelect: Story = {
    args: {controller: testcaseDataController, config: {scopeId: "placeholder"}},
    decorators: [Frame],
    parameters: {
        agenta: {
            args: tableArgs("single", {selectable: true, multiSelect: false}),
        },
    },
}

/** Selection disabled: controls visible but inert. */
export const SelectionDisabled: Story = {
    args: {controller: testcaseDataController, config: {scopeId: "placeholder"}},
    decorators: [Frame],
    parameters: {
        agenta: {
            args: tableArgs("disabled", {selectable: true, selectionDisabled: true}),
        },
    },
}

/** No selection column at all. */
export const ViewOnly: Story = {
    args: {controller: testcaseDataController, config: {scopeId: "placeholder"}},
    decorators: [Frame],
    parameters: {
        agenta: {
            args: tableArgs("view"),
        },
    },
}
