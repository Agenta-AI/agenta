import React, {useState} from "react"
import {BulbFilled} from "@ant-design/icons"
import {Space} from "antd"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {MDXProvider} from "@mdx-js/react"

import slide1 from "./TipsMarkdown/tip1.mdx"
import slide2 from "./TipsMarkdown/tip2.mdx"
import slide3 from "./TipsMarkdown/tip3.mdx"
import slide4 from "./TipsMarkdown/tip4.mdx"

const slides = [slide3, slide1, slide2, slide4]

const TipsAndFeatures = () => {
    const {appTheme} = useAppTheme()
    const [activeIndex, setActiveIndex] = useState(0)

    const handleDotClick = (index: number) => {
        setActiveIndex(index)
    }

    const getImagePath = (img: any) => {
        const theme = appTheme === "dark" ? "dark" : "light"

        const imgSrc = `/assets/tipsImages/${img}-${theme}.png`

        return imgSrc
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
                {slides.length ? slides.map((_, index) => (
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
                )):""}
            </div>

            <div
                style={{
                    borderRadius: 10,
                    margin: "10px auto",
                    width: "100%",
                    lineHeight: 1.6,
                }}
            >
                <MDXProvider
                    components={{img: (props) => <img {...props} src={getImagePath(props.src)} />}}
                >
                    {slides.length ? slides.map((Slide, index) => (
                        <div
                            key={index}
                            style={{display: index === activeIndex ? "block" : "none"}}
                            className="mdxSlider"
                        >
                            <Slide />
                        </div>
                    )) : <div style={{textAlign: "center"}}>No new features or tips are currently available. Check back later for updates!</div>}
                </MDXProvider>
            </div>
        </div>
    )
}

export default TipsAndFeatures
