import React, { useState } from 'react';
import { Row, Col, Button, Input, Card, Modal } from 'antd';
import { callVariant } from '@/lib/services/api';
import { Parameter } from '@/lib/Types';
interface TestViewProps {
    URIPath: string | null;
    inputParams: Parameter[] | null;
    optParams: Parameter[] | null;
}
const BoxComponent: React.FC<TestViewProps> = ({ inputParams, optParams, URIPath }) => {
    const { TextArea } = Input;
    const [results, setResults] = useState('');

    if (!inputParams) {
        return <div>Loading...</div>;
    }
    const [inputParamsDict, setInputParamsDict] = useState<Record<string, string>>(inputParams.reduce((dict, param) => ({ ...dict, [param.name]: param.default }), {}));
    const handleInputParamValChange = (inputParamName: string, newValue: string) => {
        setInputParamsDict(prevState => ({
            ...prevState,
            [inputParamName]: newValue
        }));
    };


    const handleRun = async () => {
        setResults("Loading..");
        try {
            const result = await callVariant(inputParamsDict, optParams, URIPath);
            setResults(result);
        } catch (e) {
            setResults("The code has resulted in the following error: \n\n --------------------- \n" + e + "---------------------\n\nPlease update your code, and re-serve it using cli and try again.\n\nFor more information please read https://docs.agenta.ai/docs/howto/how-to-debug");
        }
    }


    return (
        <Card style={{ marginBottom: '5px', padding: '5px' }}>
            <div style={{ marginBottom: '10px' }}><label >Test case</label></div>
            <Row gutter={2}>
                <Col span={12} style={{ paddingRight: '10px' }}>
                    {Object.keys(inputParamsDict).map((key, index) => (
                        <div key={index}>
                            {/* <label>{key}</label> */}
                            <TextArea
                                placeholder={key}
                                style={{ width: '100%', marginTop: 10, marginBottom: 10 }}
                                onChange={e => handleInputParamValChange(key, e.target.value)}
                            />
                        </div>))}
                    <Button onClick={handleRun} >Run</Button>
                </Col>
                <Col span={12} style={{ borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
                    <TextArea value={results} rows={6} placeholder="Results will be shown here" style={{ height: '100%', width: '100%' }} />
                </Col>
            </Row>
        </Card >


    );
};

const App: React.FC<TestViewProps> = ({ inputParams, optParams, URIPath }) => {
    const [rows, setRows] = useState([0]);

    const handleAddRow = () => {
        setRows(prevRows => [...prevRows, prevRows.length]);
    };

    return (
        <div>
            {rows.map(row => (
                <BoxComponent key={row} inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
            ))}
            <Button onClick={handleAddRow} style={{ width: '100%' }}>Add Row</Button>
        </div>

    );
};

export default App;
