import {InfoCircleOutlined} from "@ant-design/icons"
import {Button, Popover, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {EvaluationError, JSSTheme, TypedValue} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    errModalStackTrace: {
        maxWidth: 300,
        "& code": {
            display: "block",
            width: "100%",
        },
    },
}))

const EvaluationErrorPopover = (result: {
    result: TypedValue & {
        error: null | EvaluationError
    }
}) => {
    const classes = useStyles()

    return (
        <Popover
            placement="bottom"
            trigger={"click"}
            arrow={false}
            content={
                <Typography.Paragraph code className={classes.errModalStackTrace}>
                    {result.result.error?.stacktrace}
                </Typography.Paragraph>
            }
            title={result.result.error?.message}
        >
            <Button onClick={(e) => e.stopPropagation()} icon={<InfoCircleOutlined />} type="link">
                Read more
            </Button>
        </Popover>
    )
}

export default EvaluationErrorPopover
