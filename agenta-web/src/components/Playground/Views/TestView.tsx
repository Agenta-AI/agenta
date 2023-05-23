import React, { useState } from 'react';
import { Row, Col, Button, Input, Card, Space } from 'antd';
import { Parameter } from '@/helpers/openapi_parser';
import { runVariant } from '@/services/api';
import AppContext from '@/contexts/appContext';
import { param } from 'cypress/types/jquery';

interface TestViewProps {
    variantName: string;
    params: Parameter[];
}
const BoxComponent: React.FC<TestViewProps> = ({ variantName, params }) => {
    const { app } = React.useContext(AppContext);
    const { TextArea } = Input;
    const [results, setResults] = useState('');
    const initParamDict = params.reduce((dict, param) => ({ ...dict, [param.name]: param.default }), {});
    console.log("initParamDict", initParamDict); // TODO: Fix this in the long run, it needs to be updated when the params changes
    const [paramsDict, setParamsDict] = useState(initParamDict);  // in this case paramDict includes both the input and non-input params


    console.log("params", params);
    const handleRun = async (params: any) => {
        console.log("paramsDict", paramsDict);
        setResults("Loading..");
        try {
            const data = await runVariant(app, variantName, paramsDict);
            console.log("data", data);
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

const App: React.FC<TestViewProps> = ({ variantName, params }) => {
    const [rows, setRows] = useState([0]);

    const handleAddRow = () => {
        setRows(prevRows => [...prevRows, prevRows.length]);
    };

    return (
        <div>
            {rows.map(row => (
                <BoxComponent key={row} variantName={variantName} params={params} />
            ))}
            <Button onClick={handleAddRow} style={{ width: '100%' }}>Add Row</Button>
        </div>

    );
};

export default App;
