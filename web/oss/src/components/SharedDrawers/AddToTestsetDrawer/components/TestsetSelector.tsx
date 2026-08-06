import {useMemo} from "react"

import {Cascader} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"
import {Input, Typography} from "antd"

interface TestsetSelectorProps {
    cascaderValue: string[]
    cascaderOptions: any[]
    onCascaderChange: (value: any, selectedOptions: any[]) => void
    loadRevisions: (selectedOptions: any[]) => Promise<void>
    isTestsetsLoading: boolean
    renderSelectedRevisionLabel: (labels: string[], selectedOptions?: any[]) => React.ReactNode
    isNewTestset: boolean
    newTestsetName: string
    setNewTestsetName: (name: string) => void
    elementWidth: number
}

// Add ellipsis rendering to cascader options recursively
// Preserves original label as textLabel for displayRender to access
function addOptionRender(options: any[]): any[] {
    return options.map((opt) => {
        const textLabel = typeof opt.label === "string" ? opt.label : opt.textLabel
        return {
            ...opt,
            // Keep original label accessible for displayRender
            textLabel,
            // Plain text the cascader's search filters on.
            searchLabel: typeof textLabel === "string" ? textLabel : undefined,
            label: <span className="block max-w-[170px] truncate">{opt.label}</span>,
            children: opt.children ? addOptionRender(opt.children) : undefined,
        }
    })
}

export function TestsetSelector({
    cascaderValue,
    cascaderOptions,
    onCascaderChange,
    loadRevisions,
    isTestsetsLoading,
    renderSelectedRevisionLabel,
    isNewTestset,
    newTestsetName,
    setNewTestsetName,
    elementWidth,
}: TestsetSelectorProps) {
    // Transform options to use Typography.Text with ellipsis
    const optionsWithEllipsis = useMemo(() => addOptionRender(cascaderOptions), [cascaderOptions])

    return (
        <div className="flex flex-col gap-1">
            <Typography.Text className="font-medium">1. Select Testset</Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
                Choose an existing testset to append data, or create a new one
            </Typography.Text>
            <div className="flex gap-2 mt-1">
                <Cascader
                    showSearch
                    aria-label="Select testset"
                    style={{width: elementWidth}}
                    placeholder="Select testset (auto-selects latest revision)"
                    value={cascaderValue}
                    options={optionsWithEllipsis}
                    onChange={onCascaderChange}
                    loadData={loadRevisions}
                    loading={isTestsetsLoading}
                    changeOnSelect
                    expandTrigger="hover"
                    displayRender={renderSelectedRevisionLabel}
                    columnMaxWidth={200}
                />
                {isNewTestset && (
                    <div className="relative">
                        <Input
                            style={{width: elementWidth}}
                            value={newTestsetName}
                            onChange={(e) => setNewTestsetName(e.target.value)}
                            placeholder="Testset name"
                            data-tour="testset-name-input"
                        />
                        <PencilSimple size={14} className="absolute top-[8px] right-2" />
                    </div>
                )}
            </div>
        </div>
    )
}
