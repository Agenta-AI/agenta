import {Resizable} from "react-resizable"

import {GenericObject} from "@/oss/lib/Types"

import {useStyles} from "./styles"

const ResizableTitle: React.FC<GenericObject> = (props) => {
    const classes = useStyles()
    const {onResize, width, children: _children, minWidth, ...restProps} = props
    const children = Array.isArray(_children) ? _children.filter(Boolean) : _children

    if (!width) {
        return <th {...restProps}>{children}</th>
    }

    return (
        <Resizable
            width={width}
            height={0}
            handle={
                <span
                    className={classes.resizableHandle}
                    onClick={(e) => {
                        e.stopPropagation()
                    }}
                />
            }
            onResize={onResize}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th {...restProps}>{children}</th>
        </Resizable>
    )
}

export default ResizableTitle
