import {Badge} from "@agenta/ui/ui"

/** "v3": the revision a run used, beside the test set or the variant. Nothing without one. */
export const RunVersionChip = ({version}: {version: string | null}) =>
    version ? (
        <Badge variant="default" className="shrink-0 px-1 py-0 text-[11px] font-normal">
            v{version}
        </Badge>
    ) : null
