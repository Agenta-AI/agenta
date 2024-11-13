import {_Evaluation, JSSTheme} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {Modal, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

type DeleteAutoEvalModalProps = {
    evaluationType: string
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& h1": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            fontWeight: theme.fontWeightStrong,
            marginBottom: theme.paddingXS,
        },
    },
    delText: {
        color: theme.colorPrimary,
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
        textTransform: "capitalize",
    },
}))
const DeleteEvaluationModal = ({evaluationType, ...props}: DeleteAutoEvalModalProps) => {
    const classes = useStyles()

    return (
        <Modal
            {...props}
            okText={"Delete"}
            okType="danger"
            okButtonProps={{icon: <DeleteOutlined />, type: "primary"}}
            centered
            zIndex={2000}
        >
            <div className={classes.container}>
                <Typography.Title>Are you sure you want to delete?</Typography.Title>

                <div className="flex flex-col gap-4">
                    <Typography.Text>
                        A deleted {evaluationType} cannot be restored.
                    </Typography.Text>

                    <div className="flex flex-col gap-1">
                        <Typography.Text>You are about to delete:</Typography.Text>
                        <Typography.Text className={classes.delText}>
                            {evaluationType}
                        </Typography.Text>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default DeleteEvaluationModal
