import {Skeleton} from "antd"
import clsx from "clsx"

/**
 * Loading row for sidebar content whose text is unknown (entity names, list items).
 * Convention: skeleton = unknown content; disabled item = known content pending
 * navigation; text placeholder = terminal idle/empty/error states.
 */
const SidebarRowSkeleton = ({block = false}: {block?: boolean}) => (
    <Skeleton.Button
        active
        size="small"
        block={block}
        className={clsx("!h-4", block ? "!min-w-[72px]" : "!w-24 !min-w-0")}
    />
)

export default SidebarRowSkeleton
