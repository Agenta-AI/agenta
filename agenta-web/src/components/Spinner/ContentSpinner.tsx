import React from "react"
import {Spin} from "antd"
import {SpinFCType} from "antd/es/spin"
import {createUseStyles} from "react-jss"

type Props = {
    text?: string
    containerProps?: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
    innerContainerProps?: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLDivElement>,
        HTMLDivElement
    >
    spinnerProps?: SpinFCType
}

const useStyles = createUseStyles({
    container: {
        width: "100%",
        height: "100%",
        flex: 1,
        display: "grid",
        placeItems: "center",
    },
    inner: {
        display: "inline-block",
        textAlign: "center",
    },
})

const ContentSpinner: React.FC<Props> = ({
    text,
    containerProps,
    innerContainerProps,
    spinnerProps,
}) => {
    const classes = useStyles()

    return (
        <div
            {...containerProps}
            className={`${classes.container} ${containerProps?.className || ""}`}
        >
            <div
                {...innerContainerProps}
                className={`${classes.inner} ${innerContainerProps?.className || ""}`}
            >
                <Spin {...spinnerProps} tip={text} />
            </div>
        </div>
    )
}

export default ContentSpinner
