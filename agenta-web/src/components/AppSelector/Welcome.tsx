import React from "react"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import Image from "next/image"
import {Button, Card, Divider, Typography} from "antd"
import {ArrowRight} from "@phosphor-icons/react"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        width: 395,
        transition: "all 0.025s ease-in",
        boxShadow:
            "0px 2px 4px 0px rgba(0, 0, 0, 0.02), 0px 1px 6px -1px rgba(0, 0, 0, 0.02), 0px 1px 2px 0px rgba(0, 0, 0, 0.03)",
        "& > .ant-card-head": {
            padding: theme.paddingSM,
            minHeight: 46,
            "& .ant-card-head-title": {
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
            },
        },
        "& > .ant-card-body": {
            paddingTop: theme.paddingSM,
            paddingInline: 0,
            paddingBottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
        },
    },
    cardBody: {
        gap: 8,
        paddingInline: theme.paddingSM,
        flex: 1,
    },
    button: {
        width: "94%",
        display: "flex",
        alignItems: "center",
        marginInline: "auto",
        marginBottom: theme.marginSM,
        "& > .ant-btn-icon": {
            marginTop: 4,
        },
    },
}))

interface Props {
    onWriteOwnApp: () => void
    onCreateFromTemplate: () => void
}

const Welcome: React.FC<Props> = ({onWriteOwnApp, onCreateFromTemplate}) => {
    const classes = useStyles()

    const templatePoints = [
        "Compare prompts and models",
        "Create testsets",
        "Evaluate outputs",
        "Deploy in one click",
    ]
    const complexLLM = [
        "Use Langchain, Llama Index, or any framework",
        "Use OpenAI, Cohere, or self-hosted open-source models",
        "Continue in the UI: Everything in the left",
        "Streamline collaboration between devs and domain experts!",
    ]
    return (
        <section className="flex flex-col justify-center gap-10">
            <div className="text-center">
                <Image
                    src="/assets/light-complete-transparent-CROPPED.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                    className="block mx-auto"
                />
                <Typography.Title level={3}>
                    Start building and testing your LLM <br /> applications with Agenta AI.{" "}
                </Typography.Title>
            </div>

            <div className="flex items-center justify-center gap-4">
                <Card title="Quick start with a template" className={classes.card}>
                    <div className={classes.cardBody}>
                        <Typography.Text>
                            Setup an app using our preset LLM config and explore Agenta AI
                        </Typography.Text>
                        <ul className="-ml-5">
                            {templatePoints.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <Divider className="mb-3 mt-2" />
                        <Button
                            type="primary"
                            className={classes.button}
                            iconPosition="end"
                            icon={<ArrowRight size={18} />}
                            size="large"
                            onClick={onCreateFromTemplate}
                            data-cy="create-from-template__no-app"
                        >
                            Start with a template
                        </Button>
                    </div>
                </Card>

                <Card title="Build complex LLM apps" className={classes.card}>
                    <div className={classes.cardBody}>
                        <Typography.Text>
                            Create your own complex application using any framework.
                        </Typography.Text>
                        <ul className="-ml-5">
                            {complexLLM.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <Divider className="mb-3 mt-2" />
                        <Button
                            type="primary"
                            className={classes.button}
                            iconPosition="end"
                            icon={<ArrowRight size={18} />}
                            size="large"
                            onClick={onWriteOwnApp}
                        >
                            Setup your own app
                        </Button>
                    </div>
                </Card>
            </div>
        </section>
    )
}

export default Welcome
