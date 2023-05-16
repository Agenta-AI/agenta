import React, { useState } from 'react';
import { Row, Col, Button, Input, Card, Space } from 'antd';

const BoxComponent = () => {
    const { TextArea } = Input;
    const [results, setResults] = useState('');
    const [startupName, setStartupName] = useState('');
    const [startupIdea, setStartupIdea] = useState('');
    const handleRun = () => {
        fetch('http://localhost/pitch_genius/v2/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'accept': 'application/json'
            },
            body: JSON.stringify({
                startup_name: startupName,
                startup_idea: startupIdea
            })
        })
            .then(response => response.json())
            .then(data => setResults(data))
            .catch(error => console.error('Error:', error));
    };


    return (
        <Card style={{ marginBottom: '5px', padding: '5px' }}>
            <Row gutter={[5]}>
                <Col span={12} style={{ paddingRight: '19px' }}>
                    <label>Startup Name</label>
                    <TextArea
                        placeholder="Startup Name"
                        style={{ width: '100%', marginTop: 10, marginBottom: 10 }}
                        onChange={e => setStartupName(e.target.value)}
                    />
                    <label>Startup Idea</label>
                    <TextArea
                        placeholder="Startup Idea "
                        style={{ width: '100%', marginTop: 10, marginBottom: 10 }}
                        onChange={e => setStartupName(e.target.value)}
                    />
                    <Button onClick={handleRun}>Run</Button>
                </Col>
                <Col span={12} style={{ borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
                    <TextArea rows={6} placeholder="Results will be shown here" style={{ height: '100%', width: '100%' }} />
                </Col>
            </Row>
        </Card >

    );
};

const App = () => {
    const [rows, setRows] = useState([0]);

    const handleAddRow = () => {
        setRows(prevRows => [...prevRows, prevRows.length]);
    };

    return (
        <div>
            {rows.map(row => (
                <BoxComponent key={row} />
            ))}
            <Button onClick={handleAddRow}>Add Row</Button>
        </div>

    );
};

export default App;
