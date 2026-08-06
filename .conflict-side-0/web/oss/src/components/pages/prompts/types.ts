import type {InfiniteTableRowBase} from "@agenta/ui/table"

import type {FolderTreeItem} from "./assets/utils"

export type PromptsTableRow = FolderTreeItem &
    InfiniteTableRowBase & {
        children?: PromptsTableRow[]
    }
