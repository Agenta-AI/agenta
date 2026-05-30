import {Typography} from "antd"
import clsx from "clsx"

const ShowErrorMessage = ({info, className}: any) => {
    return (
        <div className={clsx("text-center mb-4", className)}>
            <Typography.Text className="text-colorError font-medium">
                {info.message}
            </Typography.Text>
            <div className="text-colorTextSecondary">{info.sub}</div>
        </div>
    )
}

export default ShowErrorMessage
