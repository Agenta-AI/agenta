import React, {useState} from "react"
import {Row, Col, Button, Input, Card, Space} from "antd"

const App = () => {
    const {TextArea} = Input
    const [rows, setRows] = useState([0])

    const handleAddRow = () => {
        setRows((prevRows) => [...prevRows, prevRows.length])
    }

    return (
        <div>
            <Card style={{marginBottom: "5px", padding: "5px"}}>
                <TextArea
                    rows={30}
                    placeholder="Logs will be shown here"
                    style={{height: "100%", width: "100%"}}
                />
            </Card>
        </div>
    )
}

export default App
