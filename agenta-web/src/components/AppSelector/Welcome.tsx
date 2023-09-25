import {Button, Tag, Tooltip} from "antd"
import React from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
// import Image from "next/image"
// import SimpleStartImg from "/assets/simple-img.png"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    wrapper: {
        display: "flex",
        justifyContent: "space-between",
        borderRadius: 10,
        padding: 20,
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
            backgroundColor: themeMode === "dark" ? "rgba(0,0,0,0.3)" : "#e6fae7",
        },
    }),
    title: {display: "flex", alignItems: "center", justifyContent: "center", gap: "15px"},
    tag: ({themeMode}: StyleProps) => ({
        fontSize: 14,
        padding: "4px 10px",
        color: "#fff",
        backgroundColor: themeMode === "dark" ? "#006006" : "#0b8834b1",
        border: `1px solid ${themeMode === "dark" ? "#006006" : "#000"}`,
    }),
    btnContainer: {
        textAlign: "right",
        marginTop: "auto",
    },
    btn: ({themeMode}: StyleProps) => ({
        backgroundColor: themeMode === "dark" ? "#fa8416" : "#009432",
        "&:not([disabled]):hover": {
            backgroundColor: `${themeMode === "dark" ? "#ff9a3c" : "#10b045"} !important`,
        },
        "&:not([disabled]):active": {
            backgroundColor: `${themeMode === "dark" ? "#ff9a3c" : "#10b045"} !important`,
        },
    }),
    img: ({themeMode}: StyleProps) => ({
        width: "100%",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
})

interface Props {
    onCreateAppClick: () => void
}

const Welcome: React.FC<Props> = ({onCreateAppClick}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const isDemo = process.env.NEXT_PUBLIC_FF === "demo"
    return (
        <>
            <section className={classes.wrapper}>
                <div className={classes.container}>
                    <div className={classes.title}>
                        <h1 style={{fontWeight: 600, fontSize: 24}}>Simple start</h1>
                        <Tag className={classes.tag}>2-3 mins</Tag>
                    </div>

                    <img
                        src="/assets/simple-img.png"
                        alt="Simple start Image"
                        className={classes.img}
                    />

                    <ul>
                        <li>Start from a template</li>
                        <li>Compare prompts and models</li>
                        <li>Create testsets</li>
                        <li>Evaluate outputs</li>
                        <li>Deploy in one click</li>
                    </ul>

                    <div className={classes.btnContainer}>
                        <Button
                            size="large"
                            type="primary"
                            className={classes.btn}
                            onClick={onCreateAppClick}
                        >
                            Start
                        </Button>
                    </div>
                </div>
                <div className={classes.container}>
                    <div className={classes.title}>
                        <h1 style={{fontWeight: 600, fontSize: 24}}>Build complex apps</h1>
                        <Tag className={classes.tag}>12-15 mins</Tag>
                    </div>

                    <img
                        src="/assets/complex-img.png"
                        alt="Complex build Image"
                        className={classes.img}
                    />

                    <ul>
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
                        <Button
                            size="large"
                            type="primary"
                            className={classes.btn}
                            disabled={!isDemo}
                        >
                            <Tooltip title="start">Start</Tooltip>
                        </Button>
                    </div>
                </div>
            </section>
        </>
    )
}

export default Welcome
