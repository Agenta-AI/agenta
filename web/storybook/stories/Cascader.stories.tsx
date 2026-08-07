import {useCallback, useState} from "react"

import {Cascader, type CascaderOption} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Cascader as AntCascader} from "antd"

// Phase-0 parity story: the REAL antd Cascader behind the app theme, side by side with the
// @agenta/ui re-skin that replaces it.
const meta = {
    title: "@agenta/ui/Primitives/Forms/Cascader",
    component: AntCascader,
    subcomponents: {"Cascader (@agenta/ui)": Cascader},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Cascader` shown beside the `@agenta/ui` Cascader that replaces it. The agenta version covers the subset the app actually uses: `options`, `value`, `onChange`, `loadData`, `loading`, `changeOnSelect`, `expandTrigger`, `displayRender`, `placeholder`, `allowClear`, `showSearch`, `disabled`, plus `columnMaxWidth` in place of antd's `popupMenuColumnStyle`.\n\n**Used in:** 3 places — the EE audit-log filters (`ee/src/components/pages/settings/AuditLog`), the add-to-testset drawer testset selector, and the entity picker cascader variant.",
            },
        },
    },
} satisfies Meta<typeof AntCascader>

export default meta
type Story = StoryObj

// antd Cascader defaults to controlWidth 184px, so the antd half needs `w-full` like the app's call-sites.
const CONTROL_BOX = "w-[260px] shrink-0"

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[13rem_auto_auto] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className={CONTROL_BOX}>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className={CONTROL_BOX}>
                {s}
            </div>
        </div>
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
    const [ant, setAnt] = useState<string[]>()
    const [ag, setAg] = useState<string[]>()
    return (
        <Row
            label="static options · showSearch"
            a={
                <AntCascader
                    className="w-full"
                    showSearch
                    placeholder="Event"
                    options={EVENTS}
                    value={ant}
                    onChange={(v) => setAnt(v as string[])}
                />
            }
            s={
                <Cascader
                    showSearch
                    aria-label="Event (static)"
                    placeholder="Event"
                    options={EVENTS}
                    value={ag}
                    onChange={setAg}
                />
            }
        />
    )
}

const HoverExpand = () => {
    const [ant, setAnt] = useState<string[]>()
    const [ag, setAg] = useState<string[]>()
    return (
        <Row
            label='expandTrigger="hover"'
            a={
                <AntCascader
                    className="w-full"
                    expandTrigger="hover"
                    placeholder="Hover to expand"
                    options={EVENTS}
                    value={ant}
                    onChange={(v) => setAnt(v as string[])}
                />
            }
            s={
                <Cascader
                    expandTrigger="hover"
                    aria-label="Event (hover expand)"
                    placeholder="Hover to expand"
                    options={EVENTS}
                    value={ag}
                    onChange={setAg}
                />
            }
        />
    )
}

const ChangeOnSelect = () => {
    const [ant, setAnt] = useState<string[]>()
    const [ag, setAg] = useState<string[]>()
    return (
        <Row
            label="changeOnSelect (commits every level)"
            a={
                <AntCascader
                    className="w-full"
                    changeOnSelect
                    placeholder="Any level"
                    options={EVENTS}
                    value={ant}
                    onChange={(v) => setAnt(v as string[])}
                />
            }
            s={
                <Cascader
                    changeOnSelect
                    aria-label="Event (changeOnSelect)"
                    placeholder="Any level"
                    options={EVENTS}
                    value={ag}
                    onChange={setAg}
                />
            }
        />
    )
}

const DisplayRender = () => {
    const [ant, setAnt] = useState<string[]>(["evaluations", "evaluations.runs"])
    const [ag, setAg] = useState<string[]>(["evaluations", "evaluations.runs"])
    const render = (labels: string[]) => <span className="font-mono">{labels.join(".")}</span>
    return (
        <Row
            label="displayRender (dotted, mono)"
            a={
                <AntCascader
                    className="w-full"
                    changeOnSelect
                    displayRender={render}
                    options={EVENTS}
                    value={ant}
                    onChange={(v) => setAnt(v as string[])}
                />
            }
            s={
                <Cascader
                    changeOnSelect
                    aria-label="Event (displayRender)"
                    displayRender={render}
                    options={EVENTS}
                    value={ag}
                    onChange={setAg}
                />
            }
        />
    )
}

const AllowClear = () => {
    const [ant, setAnt] = useState<string[]>(["applications", "applications.variants"])
    const [ag, setAg] = useState<string[]>(["applications", "applications.variants"])
    return (
        <Row
            label="allowClear"
            a={
                <AntCascader
                    className="w-full"
                    allowClear
                    changeOnSelect
                    options={EVENTS}
                    value={ant}
                    onChange={(v) => setAnt((v ?? []) as string[])}
                />
            }
            s={
                <Cascader
                    allowClear
                    changeOnSelect
                    aria-label="Event (allowClear)"
                    options={EVENTS}
                    value={ag}
                    onChange={setAg}
                />
            }
        />
    )
}

const LazyLoad = () => {
    const antTree = useLazyTestsets()
    const agTree = useLazyTestsets()
    const [ant, setAnt] = useState<string[]>()
    const [ag, setAg] = useState<string[]>()
    return (
        <Row
            label="loadData (lazy children, 700ms)"
            a={
                <AntCascader
                    className="w-full"
                    showSearch
                    changeOnSelect
                    expandTrigger="hover"
                    placeholder="Select testset"
                    options={antTree.options}
                    loadData={(sel) => antTree.loadData(sel as {value: string}[])}
                    value={ant}
                    onChange={(v) => setAnt(v as string[])}
                    popupMenuColumnStyle={{maxWidth: 200}}
                />
            }
            s={
                <Cascader
                    showSearch
                    changeOnSelect
                    expandTrigger="hover"
                    aria-label="Testset (lazy)"
                    placeholder="Select testset"
                    options={agTree.options}
                    loadData={agTree.loadData}
                    value={ag}
                    onChange={setAg}
                    columnMaxWidth={200}
                />
            }
        />
    )
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Basic />
            <HoverExpand />
            <ChangeOnSelect />
            <DisplayRender />
            <AllowClear />
            <LazyLoad />
            <Row
                label="loading (root options pending)"
                a={<AntCascader className="w-full" loading placeholder="Loading" options={[]} />}
                s={<Cascader loading aria-label="Loading" placeholder="Loading" options={[]} />}
            />
            <Row
                label="disabled"
                a={
                    <AntCascader
                        className="w-full"
                        disabled
                        placeholder="Disabled"
                        options={EVENTS}
                    />
                }
                s={
                    <Cascader
                        disabled
                        aria-label="Disabled"
                        placeholder="Disabled"
                        options={EVENTS}
                    />
                }
            />
            <Row
                label="empty options"
                a={<AntCascader className="w-full" placeholder="Nothing here" options={[]} />}
                s={<Cascader aria-label="Empty" placeholder="Nothing here" options={[]} />}
            />
        </div>
    ),
}
