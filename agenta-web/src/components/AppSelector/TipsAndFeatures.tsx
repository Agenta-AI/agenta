import React, {useState} from "react"
import {BulbFilled} from "@ant-design/icons"
import {Space} from "antd"
import {useAppTheme} from "../Layout/ThemeContextProvider"

const TipsAndFeatures = () => {
    const {appTheme} = useAppTheme()
    const [activeIndex, setActiveIndex] = useState(0)

    const items = [
        {
            title: "Installing the SDK and CLI",
            tip: "To install the SDK and CLI, you can use pip",
            code: "pip install agenta",
        },
        {
            tip: "Agenta provides you with the tools to quickly do prompt engineering and 🧪 experiment, ⚖️ evaluate, and 🚀 deploy your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.",
        },
    ]

    const handleDotClick = (index: number) => {
        setActiveIndex(index)
    }

    return (
        <div
            style={{
                backgroundColor: appTheme === "dark" ? "#000" : "rgba(0,0,0,0.03)",
                borderRadius: 10,
                padding: 20,
                margin: "30px auto",
                maxWidth: 700,
                width: "100%",
            }}
        >
            <Space>
                <BulbFilled style={{fontSize: 24, color: "rgb(255, 217, 0)"}} />
                <h1 style={{margin: "8px 0"}}>Features and Tips</h1>
            </Space>

            <div style={{textAlign: "center", marginBottom: "20px"}}>
                {items.map((_, index) => (
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
                    border: `1px solid #0e9c1a`,
                    maxWidth: 800,
                    margin: "10px auto",
                    width: "100%",
                    padding: "0 20px",
                    lineHeight: 1.6,
                    backgroundColor: appTheme === "dark" ? "rgb(20, 20, 20)" : "#fff",
                }}
            >
                {items.map((item, index) => (
                    <div key={index} style={{display: index === activeIndex ? "block" : "none"}}>
                        <h1>{item.title}</h1>
                        <p>{item.tip}</p>
                        {item.code && (
                            <code
                                style={{
                                    padding: 10,
                                    borderRadius: 7,
                                    backgroundColor: "#0e9c1a",
                                    margin: "20px 0",
                                    display: "block",
                                    color: "#000",
                                }}
                            >
                                {item.code}
                            </code>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default TipsAndFeatures
