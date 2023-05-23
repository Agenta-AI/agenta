// SubNavigation.tsx
import { useState, useEffect } from 'react';
import React from 'react';
import { Tabs, Input, Select, Slider, Row, Col, Button } from 'antd';
import TestView from './Views/TestView';
import LogsView from './Views/LogsView';
import ParametersView from './Views/ParametersView';
import { Parameter, parseOpenApiSchema } from '@/helpers/openapi_parser';
import { fetchVariantParameters } from '@/services/api'; // Import fetchVariantParameters() from api.ts
import AppContext from '@/contexts/appContext';
const { TabPane } = Tabs;
const { Option } = Select;

interface ViewNavigationProps {
    variant: { variant_name: string };
}

const ViewNavigation: React.FC<ViewNavigationProps> = ({ variant }) => {
    const { app } = React.useContext(AppContext);
    const [params, setParams] = useState<Parameter[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [inputValue, setInputValue] = useState(1);

    const handlePramsChange = (newParams: Parameter[]) => {
        setParams(newParams);
        console.log(params)
    };

    useEffect(() => {
        const fetchAndSetSchema = async () => {
            try {
                const initialParams = await fetchVariantParameters(app, variant.variant_name);
                setParams(initialParams);
            } catch (e) {
                setError(e);
            } finally {
                setLoading(false);
            }
        };

        fetchAndSetSchema();
    }, [variant]);

    if (loading) {
        return <div>Loading...</div>;
    }
    if (error) {
        return <div>Error: {error.message}</div>;
    }

    return (
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters" key="1">
                <ParametersView params={params} onParamsChange={handlePramsChange} />
            </TabPane>
            <TabPane tab="Test" key="2">
                <TestView params={params} variantName={variant.variant_name} />
            </TabPane>
            <TabPane tab="Logs" key="3">
                <LogsView />
            </TabPane>
        </Tabs>
    );
};

export default ViewNavigation;

