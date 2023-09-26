import {Button, Tag, Tooltip, Typography} from "antd"
import React from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
import {ClockCircleOutlined} from "@ant-design/icons"
import {isDemo} from "@/constants/environment"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    wrapper: {
        display: "flex",
        justifyContent: "space-between",
        gap: 20,
    },
    container: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        border: "1px solid #000",
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
    steps: {
        fontSize: 16,
        margin: "10px 0",
        display: "flex",
        flexDirection: "column",
        "& h3": {
            fontSize: 18,
            fontWeight: 600,
        },
    },
})

interface Props {
    onCreateAppClick: () => void
}

const Welcome: React.FC<Props> = ({onCreateAppClick}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const {Text} = Typography

    return (
        <>
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
                        {/* <h3>Workflow Essentials</h3> */}
                        <li>Start from a template</li>
                        <li>Compare prompts and models</li>
                        <li>Create testsets</li>
                        <li>Evaluate outputs</li>
                        <li>Deploy in one click</li>
                    </ul>

                    <div className={classes.btnContainer}>
                        <Button size="large" type="primary" onClick={onCreateAppClick}>
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
                        <h3>Workflow Essentials</h3>
                        <li>Start from code</li>
                        <li>Compare different workflows</li>
                        <li>Test parameters in the UI</li>
                        <li>Evaluate outputs</li>
                        <li>Deploy in one click</li>
                        <li>Start from a template</li>
                        <li>Compare prompts and models</li>
                        <li>Create testsets</li>
                        <li>Evaluate outputs</li>
                        <li>Deploy in one click</li>
                    </ul>

                    <div className={classes.btnContainer}>
                        <Tooltip
                            title={!isDemo ? "Feature Available only in Open-Source Version" : ""}
                        >
                            <Button size="large" type="primary" disabled={!isDemo}>
                                Start
                            </Button>
                        </Tooltip>
                    </div>
                </div>
            </section>
        </>
    )
}

export default Welcome
