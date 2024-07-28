import React, {useEffect, useState} from "react"
import {BulbFilled} from "@ant-design/icons"
import {Space} from "antd"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {MDXProvider} from "@mdx-js/react"
import {StyleProps} from "@/lib/Types"
import Image from "next/image"

import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    container: ({themeMode}: StyleProps) => ({
        backgroundColor: themeMode === "dark" ? "#000" : "rgba(0,0,0,0.03)",
        borderRadius: 10,
        padding: 20,
        width: "100%",
        margin: "30px auto",
    }),
    header: {
        "& svg": {
            fontSize: 24,
            color: "rgb(255, 217, 0)",
        },
        "& h1": {
            margin: "8px 0",
        },
    },
    dotsContainer: {
        textAlign: "center",
        marginBottom: "20px",
    },
    dots: {
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        margin: "0 5px",
        cursor: "pointer",
    },
    mdxContainer: {
        borderRadius: 10,
        margin: "10px auto",
        width: "100%",
        lineHeight: 1.6,
    },
    img: {
        width: "100%",
        height: "auto",
    },
})

const slides: any[] = []

const TipsAndFeatures = () => {
    const {appTheme} = useAppTheme()
    const [activeIndex, setActiveIndex] = useState(0)
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    const handleDotClick = (index: number) => {
        setActiveIndex(index)
    }

    const getImagePath = (img: any) => {
        const theme = appTheme === "dark" ? "dark" : "light"

        const imgSrc = `/assets/tips-images/${img}-${theme}.png`

        return imgSrc
    }

    useEffect(() => {
        const interval = setInterval(() => {
            setActiveIndex((prevIndex) => (prevIndex + 1) % slides.length)
        }, 3000)

        return () => {
            clearInterval(interval)
        }
    }, [])

    return (
        <>
            {slides.length ? (
                <div className={classes.container}>
                    <Space className={classes.header}>
                        <BulbFilled />
                        <h1>Highlights</h1>
                    </Space>

                    <div className={classes.dotsContainer}>
                        {slides.map((_, index) => (
                            <span
                                key={index}
                                style={{
                                    background: index === activeIndex ? "#0e9c1a" : "#999",
                                }}
                                className={classes.dots}
                                onClick={() => handleDotClick(index)}
                            />
                        ))}
                    </div>

                    <div className={classes.mdxContainer}>
                        <MDXProvider
                            components={{
                                img: (props) => (
                                    <Image
                                        {...props}
                                        src={getImagePath(props.src)}
                                        alt="tips-and-tricks"
                                        className={classes.img}
                                        sizes="100vw"
                                        width={500}
                                        height={300}
                                    />
                                ),
                            }}
                        >
                            {slides.map((Slide, index) => (
                                <div
                                    key={index}
                                    style={{display: index === activeIndex ? "block" : "none"}}
                                    className="mdxSlider"
                                >
                                    <Slide />
                                </div>
                            ))}
                        </MDXProvider>
                    </div>
                </div>
            ) : (
                ""
            )}
        </>
    )
}

export default TipsAndFeatures
