import {checkIfResourceValidForDeletion} from "@/lib/helpers/evaluate"
import {EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {deleteEvaluatorConfig} from "@/services/evaluations/api"
import {ExclamationCircleOutlined} from "@ant-design/icons"
import {Modal, Space, theme, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

type DeleteModalProps = {
    selectedEvalConfig: EvaluatorConfig
    onSuccess: () => void
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightStrong,
        lineHeight: theme.lineHeightLG,
    },
}))

const DeleteModal = ({selectedEvalConfig, onSuccess, ...props}: DeleteModalProps) => {
    const classes = useStyles()
    const {
        token: {colorWarning},
    } = theme.useToken()
    const [isLoading, setIsLoading] = useState(false)

    const handleDelete = async () => {
        try {
            if (
                !(await checkIfResourceValidForDeletion({
                    resourceType: "evaluator_config",
                    resourceIds: [selectedEvalConfig.id],
                }))
            )
                return
            try {
                setIsLoading(true)
                await deleteEvaluatorConfig(selectedEvalConfig.id)
                await onSuccess()
                props.onCancel?.({} as any)
            } catch (error) {
                console.error(error)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }
    return (
        <Modal
            title={
                <Space>
                    <ExclamationCircleOutlined style={{color: colorWarning}} />
                    <Typography className={classes.title}>Delete evaluator</Typography>
                </Space>
            }
            centered
            okText={"Delete"}
            okButtonProps={{danger: true, loading: isLoading}}
            onOk={handleDelete}
            {...props}
        >
            <Typography>Are you sure you want to delete this evaluator?</Typography>
        </Modal>
    )
}

export default DeleteModal
