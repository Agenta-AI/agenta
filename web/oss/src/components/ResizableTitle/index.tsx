import {Resizable} from "react-resizable"

import {GenericObject} from "@/oss/lib/Types"

import {useStyles} from "./styles"

const ResizableTitle: React.FC<GenericObject> = (props) => {
    const classes = useStyles()
    const {onResize, width, ...restProps} = props

    if (!width) {
        return <th {...restProps} />
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
            <th {...restProps} />
        </Resizable>
    )
}

export default ResizableTitle
