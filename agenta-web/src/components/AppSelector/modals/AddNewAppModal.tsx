import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {AppstoreAddOutlined, CodeOutlined} from "@ant-design/icons"
import {Col, Modal, Row, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    modal: {
        "& .ant-modal-close": {
            top: 23,
        },
    },
    title: {
        margin: 0,
    },
    row: {
        marginTop: 20,
    },
    col: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        justifyContent: "center",
        padding: "1rem",
        cursor: "pointer",
        border: `1px solid`,
        borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.15)",
        borderRadius: 8,
        transition: "all 0.3s",

        "& > .anticon": {
            fontSize: 24,
        },
        "& > h5": {
            marginTop: "0.75rem",
            marginBottom: "0.25rem",
            color: "inherit",
        },
        "& > .ant-typography-secondary": {
            fontSize: 13,
        },
        "&:hover": {
            borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.4)" : "rgba(5, 5, 5, 0.3)",
        },
    }),
})

const {Title, Text} = Typography

type Props = React.ComponentProps<typeof Modal> & {
    onCreateFromTemplate: () => void
    onWriteOwnApp: () => void
}

const AddNewAppModal: React.FC<Props> = ({onCreateFromTemplate, onWriteOwnApp, ...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    return (
        <Modal
            data-cy="add-new-app-modal"
            rootClassName={classes.modal}
            centered
            footer={null}
            title={
                <Title level={4} className={classes.title}>
                    Add new app
                </Title>
            }
            width={600}
            {...props}
        >
            <Row gutter={20} className={classes.row}>
                <Col span={12}>
                    <div
                        className={classes.col}
                        onClick={onCreateFromTemplate}
                        data-cy="create-from-template"
                    >
                        <AppstoreAddOutlined />
                        <Title level={5}>Create From Template</Title>
                        <Text type="secondary">Create Quickly Simple Prompt Apps From UI</Text>
                    </div>
                </Col>
                <Col span={12}>
                    <div className={classes.col} onClick={onWriteOwnApp}>
                        <CodeOutlined />
                        <Title level={5}>Write Your Own App</Title>
                        <Text type="secondary">Create Complex LLM Apps From Your Code</Text>
                    </div>
                </Col>
            </Row>
        </Modal>
    )
}

export default AddNewAppModal
