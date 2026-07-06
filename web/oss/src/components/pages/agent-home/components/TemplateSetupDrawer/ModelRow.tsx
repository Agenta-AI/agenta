import {CheckCircle, Cube} from "@phosphor-icons/react"

import SetupRow from "./SetupRow"

/** "Required to run" model row. Agenta-managed is Ready by default (platform keys, no input). */
const ModelRow = ({model}: {model: string}) => {
    return (
        <div className="rounded-lg border border-solid border-[var(--ag-colorBorder)] p-3">
            <SetupRow
                icon={
                    <span className="flex size-9 items-center justify-center rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] text-[var(--ag-colorTextSecondary)]">
                        <Cube size={18} />
                    </span>
                }
                title="Model"
                subtitle={`Agenta-managed · Pi · ${model}`}
                right={
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ag-colorSuccess)]">
                        <CheckCircle size={13} weight="fill" />
                        Ready
                    </span>
                }
            />
        </div>
    )
}

export default ModelRow
