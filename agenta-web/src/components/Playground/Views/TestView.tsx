import React, { useState } from 'react';
import { Row, Col, Button, Input, Card, Space } from 'antd';
import { Parameter } from '@/helpers/openapi_parser';
import { preProcessFile } from 'typescript';


const BoxComponent: React.FC<Parameter[]> = ({ params }) => {
    const { TextArea } = Input;
    const [results, setResults] = useState('');
    const [paramsDict, setParamsDict] = useState({});
    console.log("params", params);
    const handleRun = async (params) => {
        setResults("Loading..");
        const urlParams = Object.entries(paramsDict).map(([key, val]) => `${key}=${encodeURIComponent(val)}`).join('&');
        const paramParams = params.filter(param => !param.input).map(param => `${param.name}=${encodeURIComponent(param.default)}`).join('&');
        const url = `http://localhost/pitch_genius/v1/generate?${urlParams}&${paramParams}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'accept': 'application/json'
                },
            });
            const data = await response.json();
            setResults(data);
        } catch (e) {
            console.error('Error:', e)
        }
    }
    const handleChange = (pramName: string, value: string) => {
        setParamsDict(prevState => ({
            ...prevState,
            [pramName]: value
        }));
    };

    const canRun = Object.values(paramsDict).some(val => val === '');
    return (
        <Card style={{ marginBottom: '5px', padding: '5px' }}>
            <Row gutter={2}>
                <Col span={12} style={{ paddingRight: '10px' }}>
                    {params.filter(param => param.input).map((param, index) => (
                        <div key={index}>
                            <label>{param.name}</label>
                            <TextArea
                                placeholder={param.name}
                                style={{ width: '100%', marginTop: 10, marginBottom: 10 }}
                                onChange={e => handleChange(param.name, e.target.value)}
                            />
                        </div>))}
                    <Button onClick={() => handleRun(params)} disabled={canRun}>Run</Button>
                </Col>
                <Col span={12} style={{ borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
                    <TextArea value={results} rows={6} placeholder="Results will be shown here" style={{ height: '100%', width: '100%' }} />
                </Col>
            </Row>
        </Card >

    );
};

const App: React.FC<Parameter[]> = ({ params }) => {
    const [rows, setRows] = useState([0]);

    const handleAddRow = () => {
        setRows(prevRows => [...prevRows, prevRows.length]);
    };

    return (
        <div>
            {rows.map(row => (
                <BoxComponent key={row} params={params} />
            ))}
            <Button onClick={handleAddRow} style={{ width: '100%' }}>Add Row</Button>
        </div>

    );
};

export default App;
