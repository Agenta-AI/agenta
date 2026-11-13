import {useCallback, useState} from "react"

import {Cascader, type CascaderOption} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Cascader",
    component: Cascader,
    parameters: {
        docs: {
            description: {
                component:
                    "A multi-level dropdown selector. Props: `options`, `value`, `onChange`, `loadData`, `loading`, `changeOnSelect`, `expandTrigger`, `displayRender`, `placeholder`, `allowClear`, `showSearch`, `disabled` and `columnMaxWidth`.\n\n**Used in:** 3 places — the EE audit-log filters (`ee/src/components/pages/settings/AuditLog`), the add-to-testset drawer testset selector, and the entity picker cascader variant.",
            },
        },
    },
} satisfies Meta<typeof Cascader>

export default meta
type Story = StoryObj

const CONTROL_BOX = "w-[260px] shrink-0"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[13rem_auto] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={CONTROL_BOX}>{children}</div>
    </div>
)

// Three-level static tree (the AuditLogFilters shape: event-type segments).
const EVENTS: CascaderOption[] = [
    {
        value: "applications",
        label: "applications",
        children: [
            {
                value: "applications.variants",
                label: "variants",
                children: [
                    {value: "applications.variants.created", label: "created"},
                    {value: "applications.variants.updated", label: "updated"},
                    {value: "applications.variants.deleted", label: "deleted", disabled: true},
                ],
            },
            {
                value: "applications.deployments",
                label: "deployments",
                children: [{value: "applications.deployments.created", label: "created"}],
            },
        ],
    },
    {
        value: "evaluations",
        label: "evaluations",
        children: [
            {
                value: "evaluations.runs",
                label: "runs",
                children: [
                    {value: "evaluations.runs.started", label: "started"},
                    {value: "evaluations.runs.finished", label: "finished"},
                ],
            },
        ],
    },
    {value: "unknown", label: "unknown"},
]

/** Lazy tree (the TestsetSelector shape): testsets whose revisions arrive via `loadData`. */
const TESTSETS: CascaderOption[] = [
    {value: "create", label: "Create New", isLeaf: true},
    {value: "ts-1", label: "Customer support golden set", isLeaf: false},
    {value: "ts-2", label: "Regression prompts", isLeaf: false},
]

function useLazyTestsets() {
    const [options, setOptions] = useState<CascaderOption[]>(TESTSETS)
    const loadData = useCallback((selected: {value: string}[]) => {
        const target = selected[selected.length - 1]
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                setOptions((prev) =>
                    prev.map((opt) =>
                        opt.value === target.value
                            ? {
                                  ...opt,
                                  children: [3, 2, 1].map((v) => ({
                                      value: `${opt.value}-v${v}`,
                                      label: `v${v}`,
                                      isLeaf: true,
                                  })),
                              }
                            : opt,
                    ),
                )
                resolve()
            }, 700)
        })
    }, [])
    return {options, loadData, reset: () => setOptions(TESTSETS)}
}

const Basic = () => {
    const [value, setValue] = useState<string[]>()
    return (
        <Row label="static options · showSearch">
            <Cascader
                showSearch
                aria-label="Event (static)"
                placeholder="Event"
                options={EVENTS}
                value={value}
                onChange={setValue}
            />
        </Row>
    )
}

const HoverExpand = () => {
    const [value, setValue] = useState<string[]>()
    return (
        <Row label='expandTrigger="hover"'>
            <Cascader
                expandTrigger="hover"
                aria-label="Event (hover expand)"
                placeholder="Hover to expand"
                options={EVENTS}
                value={value}
                onChange={setValue}
            />
        </Row>
    )
}

const ChangeOnSelect = () => {
    const [value, setValue] = useState<string[]>()
    return (
        <Row label="changeOnSelect (commits every level)">
            <Cascader
                changeOnSelect
                aria-label="Event (changeOnSelect)"
                placeholder="Any level"
                options={EVENTS}
                value={value}
                onChange={setValue}
            />
        </Row>
    )
}

const DisplayRender = () => {
    const [value, setValue] = useState<string[]>(["evaluations", "evaluations.runs"])
    const render = (labels: string[]) => <span className="font-mono">{labels.join(".")}</span>
    return (
        <Row label="displayRender (dotted, mono)">
            <Cascader
                changeOnSelect
                aria-label="Event (displayRender)"
                displayRender={render}
                options={EVENTS}
                value={value}
                onChange={setValue}
            />
        </Row>
    )
}

const AllowClear = () => {
    const [value, setValue] = useState<string[]>(["applications", "applications.variants"])
    return (
        <Row label="allowClear">
            <Cascader
                allowClear
                changeOnSelect
                aria-label="Event (allowClear)"
                options={EVENTS}
                value={value}
                onChange={setValue}
            />
        </Row>
    )
}

const LazyLoad = () => {
    const tree = useLazyTestsets()
    const [value, setValue] = useState<string[]>()
    return (
        <Row label="loadData (lazy children, 700ms)">
            <Cascader
                showSearch
                changeOnSelect
                expandTrigger="hover"
                aria-label="Testset (lazy)"
                placeholder="Select testset"
                options={tree.options}
                loadData={tree.loadData}
                value={value}
                onChange={setValue}
                columnMaxWidth={200}
            />
        </Row>
    )
}

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Basic />
            <HoverExpand />
            <ChangeOnSelect />
            <DisplayRender />
            <AllowClear />
            <LazyLoad />
            <Row label="loading (root options pending)">
                <Cascader loading aria-label="Loading" placeholder="Loading" options={[]} />
            </Row>
            <Row label="disabled">
                <Cascader disabled aria-label="Disabled" placeholder="Disabled" options={EVENTS} />
            </Row>
            <Row label="empty options">
                <Cascader aria-label="Empty" placeholder="Nothing here" options={[]} />
            </Row>
        </div>
    ),
}
