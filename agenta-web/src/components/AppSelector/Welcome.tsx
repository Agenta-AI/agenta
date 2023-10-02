import {Button, Tag} from "antd"
import React from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
import {CheckCircleFilled, ClockCircleOutlined} from "@ant-design/icons"
import TypingAnimator from "react-typing-animator"

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
    typing: {
        margin: "15px 0 20px",
        lineHeight: 1.5,
        fontWeight: "bold",
        "& .cursor": {
            width: 15,
            display: "inline-block",
        },
    },
    description: {
        lineHeight: 1.7,
    },
    wrapper: {
        display: "flex",
        justifyContent: "space-between",
        gap: 20,
        maxWidth: "1250px",
        margin: "0 auto",
        width: "100%",
    },
    container: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${themeMode === "dark" ? "#000" : "#009432"}`,
        padding: "20px",
        borderRadius: 10,
        flex: 1,
        backgroundColor: themeMode === "dark" ? "#000" : "#fff",
        "&:hover": {
            backgroundColor: themeMode === "dark" ? "#ff9c3f31" : "#ebffeb",
        },
    }),
    title: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "15px",
        "& h1": {
            fontWeight: 600,
            fontSize: 24,
        },
    },
    tag: {
        padding: "2px 6px",
        fontWeight: "bold",
    },
    btnContainer: ({themeMode}: StyleProps) => ({
        textAlign: "right",
        marginTop: "auto",
        "& button": {
            backgroundColor: themeMode === "dark" ? "#fa8416" : "#009432",
            "&:not([disabled]):hover": {
                backgroundColor: `${themeMode === "dark" ? "#ff9a3c" : "#10b045"} !important`,
            },
            "&:not([disabled]):active": {
                backgroundColor: `${themeMode === "dark" ? "#ff9a3c" : "#10b045"} !important`,
            },
        },
    }),
    img: ({themeMode}: StyleProps) => ({
        width: "100%",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    steps: ({themeMode}: StyleProps) => ({
        fontSize: 16,
        margin: "10px 0",
        display: "flex",
        flexDirection: "column",
        listStyleType: "none",
        gap: 10,
        borderRadius: 10,
        padding: 20,
        "& svg": {
            color: themeMode === "dark" ? "#fa8416" : "#009432",
            marginRight: 10,
        },
        "& span": {
            color: themeMode === "dark" ? "#fa8416" : "#009432",
            fontWeight: 600,
            textTransform: "capitalize",
        },
    }),
})

interface Props {
    onWriteOwnApp: () => void
    onCreateFromTemplate: () => void
}

const Welcome: React.FC<Props> = ({onWriteOwnApp, onCreateFromTemplate}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const textArray = [
        "Agenta is the developer-first open source LLM-Ops platform.",
        "Agenta is an open-source LLMOps platform designed to streamline the development of robust LLM applications.",
        "Agenta provides tools for quick experimentation, prompt-engineering, and evaluation, making it easier to iterate on your LLM apps.",
    ]
    return (
        <>
            <section>
                <div className={classes.heading}>
                    <h1>Welcome to Agenta</h1>
                    <img src="/assets/wave.png" />
                </div>
                <div className={classes.typing}>
                    <TypingAnimator
                        fontSize="20px"
                        textArray={textArray}
                        loop
                        typingSpeed={30}
                        delaySpeed={2000}
                        height="60px"
                        cursorColor={appTheme === "dark" ? "#fff" : "#333"}
                        textColor={appTheme === "dark" ? "#fff" : "#000"}
                    />
                </div>
                <section className={classes.wrapper}>
                    <div className={classes.container}>
                        <div className={classes.title}>
                            <h1>Simple start</h1>
                            <Tag
                                className={classes.tag}
                                icon={<ClockCircleOutlined />}
                                color={appTheme === "dark" ? "warning" : "green"}
                            >
                                2-3 mins
                            </Tag>
                        </div>

                        <img
                            src="/assets/simple-img.png"
                            alt="Simple start Image"
                            className={classes.img}
                        />

                        <ul className={classes.steps}>
                            <li>
                                <CheckCircleFilled /> Start from a template
                            </li>
                            <li>
                                <CheckCircleFilled /> Compare prompts and models
                            </li>
                            <li>
                                <CheckCircleFilled /> Create testsets
                            </li>
                            <li>
                                <CheckCircleFilled /> Evaluate outputs
                            </li>
                            <li>
                                <CheckCircleFilled /> Deploy in one click
                            </li>
                        </ul>

                        <div className={classes.btnContainer}>
                            <Button size="large" type="primary" onClick={onCreateFromTemplate}>
                                Start
                            </Button>
                        </div>
                    </div>
                    <div className={classes.container}>
                        <div className={classes.title}>
                            <h1>Build complex apps</h1>
                            <Tag
                                className={classes.tag}
                                icon={<ClockCircleOutlined />}
                                color={appTheme === "dark" ? "warning" : "green"}
                            >
                                12-15 mins
                            </Tag>
                        </div>

                        <img
                            src="/assets/complex-img.png"
                            alt="Complex build Image"
                            className={classes.img}
                        />

                        <ul className={classes.steps}>
                            <li>
                                <CheckCircleFilled /> Start <span>from code</span>
                            </li>
                            <li>
                                <CheckCircleFilled /> Compare different workflows
                            </li>
                            <li>
                                <CheckCircleFilled /> Test parameters in the UI
                            </li>
                            <li>
                                <CheckCircleFilled /> Evaluate outputs
                            </li>
                            <li>
                                <CheckCircleFilled /> Deploy in one click
                            </li>
                            <li>
                                <CheckCircleFilled /> Start from a template
                            </li>
                            <li>
                                <CheckCircleFilled /> Compare prompts and models
                            </li>
                            <li>
                                <CheckCircleFilled /> Create testsets
                            </li>
                            <li>
                                <CheckCircleFilled /> Evaluate outputs
                            </li>
                            <li>
                                <CheckCircleFilled /> Deploy in one click
                            </li>
                        </ul>
                        <div className={classes.btnContainer}>
                            <Button
                                type="primary"
                                onClick={onWriteOwnApp}
                                data-cy="create-new-app-button"
                                size="large"
                            >
                                Start
                            </Button>
                        </div>
                    </div>
                </section>
            </section>
        </>
    )
}

export default Welcome
