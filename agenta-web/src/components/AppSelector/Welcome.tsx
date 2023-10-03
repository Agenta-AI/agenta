import {Button, Divider} from "antd"
import React from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    heading: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",

        "& > h1": {
            margin: 0,
            fontSize: 42,
        },

        "& > img": {
            animation: "$wave 1.8s ease-in-out infinite",
            height: 44,
        },
    },
    h2: {
        fontSize: "24px",
        margin: "20px 0",
    },
    divider: ({themeMode}: StyleProps) => ({
        borderColor: themeMode === "dark" ? "rgba(256, 256, 256, 0.2)" : "rgba(5, 5, 5, 0.15)",
        marginTop: 0,
    }),
    blueBox: ({themeMode}: StyleProps) => ({
        backgroundColor: themeMode === "dark" ? "rgb(24, 36, 58)" : "#e6f4ff",
        borderRadius: 10,
        padding: "1rem",
        "&> h3": {
            margin: 0,
            fontSize: 20,
        },
    }),
    description: {
        padding: "0 10px",
        lineHeight: 1.7,
        marginBottom: "2rem",
        "& > p:nth-of-type(2)": {
            fontWeight: 600,
            fontSize: 18,
        },
    },
    "@keyframes wave": {
        "0%": {
            transform: "rotate(0deg)",
        },
        "10%": {
            transform: "rotate(-10deg)",
        },
        "20%": {
            transform: "rotate(12deg)",
        },
        "30%": {
            transform: "rotate(-10deg)",
        },
        "40%": {
            transform: "rotate(9deg)",
        },
        "50%": {
            transform: "rotate(0deg)",
        },
        "100%": {
            transform: "rotate(0deg)",
        },
    },
})

interface Props {
    onCreateAppClick: () => void
}

const Welcome: React.FC<Props> = ({onCreateAppClick}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const isDemo = process.env.NEXT_PUBLIC_FF === "demo"
    return (
        <div>
            <div>
                <div className={classes.heading}>
                    <h1>Welcome to Agenta</h1>
                    <img src="/assets/wave.png" />
                </div>
                <h2 className={classes.h2}>The developer-first open source LLMOps platform.</h2>
                <Divider className={classes.divider} />
            </div>
            <div className={classes.description}>
                <p>
                    🛠️ <strong>Agenta</strong> is an open-source LLMOps platform designed to
                    streamline the development of robust LLM applications.
                    <br />
                    <br />
                    🔬 Agenta provides with the tools for quick experimentation, prompt-engineering,
                    and evaluation, making it easier to iterate on your LLM apps.
                    <br />
                    <br />
                    🤝 With Agenta, you can:
                    <ul>
                        <li>🔄 Experiment and evaluate performance</li>
                        <li>📊 Make data-driven improvements</li>
                        <li>👥 Enable team collaboration</li>
                        <li>🔐 Manage version control</li>
                        <li>🚀 Enjoy one-click deployment</li>
                    </ul>
                    📚 And yes, you're free to use any framework, library, or model you prefer.
                    <br />
                </p>
                <p>
                    Read{" "}
                    <a href="https://docs.agenta.ai/introduction" target="_blank">
                        Documentation
                    </a>{" "}
                    on how to get started.
                </p>
            </div>
            <div className={classes.blueBox}>
                <h3>Get started creating your first LLM App</h3>

                {!isDemo && (
                    <p>
                        This guide assumes you have completed the installation process. If not,
                        please follow our{" "}
                        <a href="https://docs.agenta.ai/installation" target="_blank">
                            installation guide
                        </a>
                        .
                    </p>
                )}
                {isDemo && (
                    <p>
                        Important Note: You are using the demo version of Agenta. Don't forget to
                        regularly back up your data!
                        <br />
                        If you're considering integrating Agenta into your workflow, feel free to{" "}
                        <a
                            href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA"
                            target="_blank"
                        >
                            {" "}
                            join us on Slack{" "}
                        </a>{" "}
                        or{" "}
                        <a href="https://cal.com/mahmoud-mabrouk-ogzgey/demo" target="_blank">
                            schedule an onboarding session
                        </a>
                        .
                    </p>
                )}

                <Button type="primary" onClick={onCreateAppClick} data-cy="create-new-app-button">
                    Create New App
                </Button>
            </div>
        </div>
    )
}

export default Welcome
