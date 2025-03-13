import {Typography} from "antd"
import clsx from "clsx"

import {useStyles} from "./style"

const ShowErrorMessage = ({info, className}: any) => {
    const classes = useStyles()
    return (
        <div className={clsx("text-center mb-4", className)}>
            <Typography.Text className={classes.errorMessage}>{info.message}</Typography.Text>
            <div className={classes.errorSub}>{info.sub}</div>
        </div>
    )
}

export default ShowErrorMessage
