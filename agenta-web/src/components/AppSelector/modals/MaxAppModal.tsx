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

type Props = React.ComponentProps<typeof Modal> & {}

const MaxAppModal: React.FC<Props> = ({...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    return (
        <Modal
            rootClassName={classes.modal}
            centered
            footer={null}
            title={
                <Title level={4} className={classes.title}>
                    Demo Limit Reached
                </Title>
            }
            width={600}
            {...props}
        >
            <div>You've reached the maximum number of apps for the demo. To create more apps:</div>
            <div>
                - Explore our{" "}
                <a href="https://github.com/agenta-ai/agenta">open-source, self-hosted version</a>.
            </div>
            <div>
                - Or, <a href="https://cal.com/mahmoud-mabrouk-ogzgey/30min">schedule a call</a> for
                early access to our cloud solution.
            </div>
            <div>
                Questions? Feel free to reach out to our support in{" "}
                <a href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA">
                    Slack
                </a>
                .
            </div>
        </Modal>
    )
}

export default MaxAppModal
