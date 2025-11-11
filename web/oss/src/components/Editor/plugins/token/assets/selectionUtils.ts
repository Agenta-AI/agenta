import {$createRangeSelection, $setSelection, NodeKey} from "lexical"

export const navigateCursor = ({
    nodeKey,
    offset,
    type,
}: {
    nodeKey: NodeKey
    offset: number
    type?: "text" | "element"
}) => {
    const newSelection = $createRangeSelection()
    newSelection.anchor.set(nodeKey, offset, type ?? "text")
    newSelection.focus.set(nodeKey, offset, type ?? "text")
    $setSelection(newSelection)
}
