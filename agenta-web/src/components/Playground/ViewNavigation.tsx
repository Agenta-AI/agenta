// SubNavigation.tsx
import { useState, useEffect } from 'react';
import React from 'react';
import { Tabs, Input, Select, Slider, Row, Col, Button } from 'antd';
import TestView from './Views/TestView';
import LogsView from './Views/LogsView';
import ParametersView from './Views/ParametersView';
import { Parameter, parseOpenApiSchema } from '@/helpers/openapi_parser'
import { set } from 'cypress/types/lodash';
import useSWR, { Fetcher } from 'swr';

const { TabPane } = Tabs;
const { Option } = Select;

const fetcher: Fetcher<string> = (...args) => fetch(...args).then(res => res.json());

function useParams() {

    const { data, error, isLoading } = useSWR('http://localhost/pitch_genius/v0/openapi.json', fetcher)

    return {
        user: parseOpenApiSchema(data),
        isLoading,
        isError: error
    }
}
const ViewNavigation: React.FC = () => {
    const [params, setParams] = useState<Parameter[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [inputValue, setInputValue] = useState(1);
    const handlePramsChange = (newParams: Parameter[]) => {
        setParams(newParams);
        console.log(params)
    };
    useEffect(() => {
        const fetchSchema = async () => {
            try {
                const response = await fetch('http://localhost/pitch_genius/v1/openapi.json');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const schema = await response.json();
                const initialParams = parseOpenApiSchema(schema);
                setParams(initialParams);
            } catch (e) {
                setError(e);
            } finally {
                setLoading(false);
            }
        };

        fetchSchema();
    }, []);
    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error: {error.message}</div>;
    }
    console.log(params)

    const onChange = (newValue: number) => {
        setInputValue(newValue);
    };

    return (
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters" key="1">
                <ParametersView params={params} onParamsChange={handlePramsChange} />
            </TabPane>
            <TabPane tab="Test" key="2">
                <TestView params={params} />
            </TabPane>
            <TabPane tab="Logs" key="3">
                <LogsView />
            </TabPane>
        </Tabs>
    );
};

export default ViewNavigation;

