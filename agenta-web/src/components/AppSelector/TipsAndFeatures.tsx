import React, {useState} from "react"
import {BulbFilled} from "@ant-design/icons"
import {Space} from "antd"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {MDXProvider} from "@mdx-js/react"

import slide1 from "./TipsMarkdown/tip1.mdx"
import slide2 from "./TipsMarkdown/tip2.mdx"
import slide3 from "./TipsMarkdown/tip3.mdx"

const slides = [slide1, slide2, slide3]

const TipsAndFeatures = () => {
    const {appTheme} = useAppTheme()
    const [activeIndex, setActiveIndex] = useState(0)

    const handleDotClick = (index: number) => {
        setActiveIndex(index)
    }

    const getImagePath = () => {
        return appTheme === "dark"
            ? "/assets/tipsImages/testsets-dark.png"
            : "/assets/tipsImages/testsets-light.png"
    }

    return (
        <div
            style={{
                backgroundColor: appTheme === "dark" ? "#000" : "rgba(0,0,0,0.03)",
                borderRadius: 10,
                padding: 20,
                width: "100%",
                margin: "30px auto",
            }}
        >
            <Space>
                <BulbFilled style={{fontSize: 24, color: "rgb(255, 217, 0)"}} />
                <h1 style={{margin: "8px 0"}}>Features and Tips</h1>
            </Space>

            <div style={{textAlign: "center", marginBottom: "20px"}}>
                {slides.map((_, index) => (
                    <span
                        key={index}
                        style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: index === activeIndex ? "#0e9c1a" : "#999",
                            margin: "0 5px",
                            cursor: "pointer",
                        }}
                        onClick={() => handleDotClick(index)}
                    />
                ))}
            </div>

            <div
                style={{
                    borderRadius: 10,
                    //   maxWidth: 800,
                    margin: "10px auto",
                    width: "100%",
                    //   padding: "10px 30px",
                    lineHeight: 1.6,
                    //   backgroundColor: appTheme === "dark" ? "rgb(20, 20, 20)" : "rgba(0,0,0,0.1)",
                }}
            >
                <MDXProvider components={{img: (props) => <img {...props} src={getImagePath()} />}}>
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
    )
}

export default TipsAndFeatures
