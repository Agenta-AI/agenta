import {PencilSimple} from "@phosphor-icons/react"
import {Cascader, Input, Typography} from "antd"

interface TestsetSelectorProps {
    cascaderValue: string[]
    cascaderOptions: any[]
    onCascaderChange: (value: any, selectedOptions: any[]) => void
    loadRevisions: (selectedOptions: any[]) => Promise<void>
    isTestsetsLoading: boolean
    loadingRevisions: boolean
    renderSelectedRevisionLabel: (labels: string[], selectedOptions?: any[]) => React.ReactNode
    isNewTestset: boolean
    newTestsetName: string
    setNewTestsetName: (name: string) => void
    elementWidth: number
}

export function TestsetSelector({
    cascaderValue,
    cascaderOptions,
    onCascaderChange,
    loadRevisions,
    isTestsetsLoading,
    loadingRevisions,
    renderSelectedRevisionLabel,
    isNewTestset,
    newTestsetName,
    setNewTestsetName,
    elementWidth,
}: TestsetSelectorProps) {
    return (
        <div className="flex flex-col gap-1">
            <Typography.Text className="font-medium">1. Select Testset</Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
                Choose an existing testset to append data, or create a new one
            </Typography.Text>
            <div className="flex gap-2 mt-1">
                <Cascader
                    showSearch
                    style={{width: elementWidth}}
                    placeholder="Select testset (auto-selects latest revision)"
                    value={cascaderValue}
                    options={cascaderOptions}
                    onChange={onCascaderChange}
                    loadData={loadRevisions}
                    loading={isTestsetsLoading || loadingRevisions}
                    changeOnSelect
                    expandTrigger="hover"
                    displayRender={renderSelectedRevisionLabel}
                />
                {isNewTestset && (
                    <div className="relative">
                        <Input
                            style={{width: elementWidth}}
                            value={newTestsetName}
                            onChange={(e) => setNewTestsetName(e.target.value)}
                            placeholder="Testset name"
                        />
                        <PencilSimple size={14} className="absolute top-[8px] right-2" />
                    </div>
                )}
            </div>
        </div>
    )
}
