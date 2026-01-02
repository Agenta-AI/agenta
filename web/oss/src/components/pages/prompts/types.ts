import {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable"

import {FolderTreeItem} from "./assets/utils"

export type PromptsTableRow = (FolderTreeItem & InfiniteTableRowBase) & {
    children?: PromptsTableRow[]
}
