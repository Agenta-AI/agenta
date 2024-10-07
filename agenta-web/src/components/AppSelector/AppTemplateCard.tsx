import React from "react"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {Button, Card, Typography} from "antd"
import {ArrowRight} from "@phosphor-icons/react"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        width: 392,
        height: 268,
        display: "flex",
        cursor: "pointer",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "all 0.025s ease-in",
        boxShadow: theme.boxShadowTertiary,
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,
            "& .ant-card-head-title": {
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
            flex: 1,
        },
        "& > .ant-card-actions": {
            padding: "0 12px",
        },
        "&:hover": {
            boxShadow: theme.boxShadow,
        },
    },
    button: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        "& > .ant-btn-icon": {
            marginTop: 4,
        },
    },
}))

interface Props {
    onWriteOwnApp: () => void
    onCreateFromTemplate: () => void
}

const AppTemplateCard: React.FC<Props> = ({onWriteOwnApp, onCreateFromTemplate}) => {
    const classes = useStyles()

    const templatePoints = [
        "Test and compare prompts and models",
        "Evaluate outputs in the webUI",
        "Deploy and version prompts",
        "Track all LLM calls",
    ]
    const complexLLM = [
        "Create a playground for RAG, chain-of-prompts or agents",
        "Use Langchain, Llama Index, or any framework",
        "Evaluate and publish configuration from the webUI",
        "Collaborate with subject matter experts ",
    ]
    return (
        <section className="flex items-center gap-4">
            <Card
                title="Create your first prompt"
                className={classes.card}
                onClick={onCreateFromTemplate}
                data-cy="create-from-template"
                actions={[
                    <Button
                        type="primary"
                        key="template"
                        className={classes.button}
                        iconPosition="end"
                        icon={<ArrowRight size={18} />}
                        size="large"
                    >
                        Create a new prompt
                    </Button>,
                ]}
            >
                <div className="gap-2">
                    <Typography.Text>Quickly create a prompt and:</Typography.Text>
                    <ul className="-ml-5">
                        {templatePoints.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            </Card>

            <Card
                title="Build custom workflows"
                className={classes.card}
                onClick={onWriteOwnApp}
                actions={[
                    <Button
                        type="primary"
                        key="ownApp"
                        className={classes.button}
                        iconPosition="end"
                        icon={<ArrowRight size={18} />}
                        size="large"
                    >
                        Create your own app
                    </Button>,
                ]}
            >
                <div className="gap-2">
                    <Typography.Text>
                        Create your own complex application using any framework.
                    </Typography.Text>
                    <ul className="-ml-5">
                        {complexLLM.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            </Card>
        </section>
    )
}

export default AppTemplateCard
