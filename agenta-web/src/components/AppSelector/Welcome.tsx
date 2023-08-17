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
        padding: "0 20px",
        lineHeight: 1.7,
        marginBottom: "2rem",
        "& > p:nth-of-type(2)": {
            fontWeight: 600,
            fontSize: 15,
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
                    Agenta is an open-source developer first LLMOps platform to streamline the
                    process of building LLM-powered applications. Building LLM-powered apps is an
                    iterative process with lots of prompt-engineering and testing multiple variants.
                    <br />
                    Agenta brings the CI/CD platform to this process by enabling you to quickly
                    iterate, experiment, evaluate, and optimize your LLM apps. All without imposing
                    any restrictions on your choice of framework, library, or model.
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

                <p>
                    This guide assumes you have completed the installation process. If not, please
                    follow our{" "}
                    <a href="https://docs.agenta.ai/installation" target="_blank">
                        installation guide
                    </a>
                    .
                </p>

                <Button type="primary" onClick={onCreateAppClick}>
                    Create New App
                </Button>
            </div>
        </div>
    )
}

export default Welcome
