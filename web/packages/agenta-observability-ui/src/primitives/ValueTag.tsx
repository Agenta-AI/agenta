import {getStringOrJson} from "@agenta/shared/utils"
import {Tag} from "@agenta/ui/components/presentational"
import clsx from "clsx"

/** The app's `CustomAntdTag`: a filled tag whose value may be a JSON blob. */
export const ValueTag = ({value, className}: {value: unknown; className?: string}) => (
    <Tag
        className={clsx(className, "bg-[var(--ag-colorFillSecondary)]")}
        label={getStringOrJson(value as string)}
    />
)

export default ValueTag
