import React from "react"
import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"

// Defines the props for DraggableTabNode component.
interface DraggableTabNodeProps extends React.HTMLAttributes<HTMLDivElement> {
    "data-node-key": string // Unique identifier for the draggable item.
}

// This component wraps each tab label to make it draggable.
const DraggableTabNode: React.FC<DraggableTabNodeProps> = ({
    "data-node-key": key,
    children,
    ...props
}) => {
    // useSortable hook provides the necessary handlers and attributes for drag-and-drop.
    const {attributes, listeners, setNodeRef, transform, transition} = useSortable({id: key})

    // CSS styles to apply transform and transition for the dragging effect.
    const style: React.CSSProperties = {
        ...props.style,
        transform: CSS.Transform.toString(transform ? {...transform, scaleX: 1} : null),
        transition,
        userSelect: "none",
        cursor: "pointer", // Changes cursor to indicate draggability.
    }

    // Clones the children element to add refs and drag-and-drop related properties.
    return React.cloneElement(children as React.ReactElement, {
        ref: setNodeRef,
        style,
        ...attributes,
        ...listeners,
    })
}

export default DraggableTabNode
