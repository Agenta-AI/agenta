import {Button, Tag} from "antd"
import React from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
import {CheckCircleFilled, ClockCircleOutlined} from "@ant-design/icons"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    heading: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
    h2: {
        fontSize: 24,
        margin: "20px 0",
        textAlign: "center",
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
        justifyContent: "space-between",
        cursor: "pointer",
        flexDirection: "column",
        border: `1px solid ${themeMode === "dark" ? "rgb(13, 17, 23)" : "#91caff"}`,
        padding: "15px",
        borderRadius: 10,
        flex: 1,
        backgroundColor: themeMode === "dark" ? "#000" : "#fff",
        "&:hover": {
            backgroundColor: themeMode === "dark" ? "rgb(13, 17, 23)" : "#f3faff",
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
    img: ({themeMode}: StyleProps) => ({
        width: "100%",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    steps: ({themeMode}: StyleProps) => ({
        fontSize: 16,
        margin: "20px 0 0",
        display: "flex",
        flexDirection: "column",
        listStyleType: "none",
        padding: 20,
        "& li": {
            marginBottom: 10,
        },
        "& svg": {
            color: themeMode === "dark" ? "#fa8416" : "#0958d9",
            marginRight: 10,
        },
        "& span": {
            color: themeMode === "dark" ? "#fa8416" : "#0958d9",
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

    return (
        <>
            <section>
                <section>
                    <div className={classes.heading}>
                        <h1>Welcome to Agenta</h1>
                        <img src="/assets/wave.png" />
                    </div>
                    <h2 className={classes.h2}>The developer-first open source LLMOps platform.</h2>
                </section>
                <section className={classes.wrapper}>
                    <div className={classes.container} onClick={onCreateFromTemplate}>
                        <div className={classes.title}>
                            <h1>Simple start</h1>
                            <Tag
                                className={classes.tag}
                                icon={<ClockCircleOutlined />}
                                color={appTheme === "dark" ? "warning" : "blue"}
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
                    </div>
                    <div className={classes.container} onClick={onWriteOwnApp}>
                        <div>
                            <div className={classes.title}>
                                <h1>Build complex apps</h1>
                                <Tag
                                    className={classes.tag}
                                    icon={<ClockCircleOutlined />}
                                    color={appTheme === "dark" ? "warning" : "blue"}
                                >
                                    12-15 mins
                                </Tag>
                            </div>

                            <img
                                src="/assets/complex-img.png"
                                alt="Complex build Image"
                                className={classes.img}
                            />
                        </div>

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
                                <CheckCircleFilled /> + Everything in the left
                            </li>
                        </ul>
                    </div>
                </section>
            </section>
        </>
    )
}

export default Welcome
