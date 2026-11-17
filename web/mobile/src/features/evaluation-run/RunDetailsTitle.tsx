import {SkeletonBlock} from "@agenta/ui/ui"

/** The page heading: the run name, or a bar of its size while the run loads. */
export const RunDetailsTitle = ({name}: {name: string | null}) =>
    name === null ? (
        <div className="min-w-0 flex-1">
            <SkeletonBlock className="h-6 w-48" />
        </div>
    ) : (
        <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
            {name}
        </h1>
    )
