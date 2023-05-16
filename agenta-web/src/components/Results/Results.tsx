
import React from 'react';
import { Table, Card } from 'antd';


const Results: React.FC = () => {
    const modelData = [
        {
            key: '1',
            model: 'Model A',
            score: 70,
            confidence: '65% - 75%',
        },
        {
            key: '2',
            model: 'Model B',
            score: 60,
            confidence: '55% - 65%',
        },
        {
            key: '3',
            model: 'Model C',
            score: 80,
            confidence: '75% - 85%',
        },
    ];


    const recentComparisons = [
        {
            key: '1',
            model: 'Model A',
            score: 70,
            confidence: '65% - 75%',
        },
        {
            key: '2',
            model: 'Model B',
            score: 60,
            confidence: '55% - 65%',
        },
    ];

    const latencyData = [
        {
            key: '1',
            model: 'Model A',
            latency: 200,
            cost: 0.5,
        },
        {
            key: '2',
            model: 'Model B',
            latency: 300,
            cost: 0.6,
        },
        {
            key: '3',
            model: 'Model C',
            latency: 250,
            cost: 0.7,
        },
    ];

    const columns = [
        {
            title: 'Model',
            dataIndex: 'model',
            key: 'model',
        },
        {
            title: 'Preference Score',
            dataIndex: 'score',
            key: 'score',
        },
        {
            title: 'Confidence Interval',
            dataIndex: 'confidence',
            key: 'confidence',
        },
    ];

    const latencyColumns = [
        {
            title: 'Model',
            dataIndex: 'model',
            key: 'model',
        },
        {
            title: 'Latency (ms)',
            dataIndex: 'latency',
            key: 'latency',
        },
        {
            title: 'Average Cost ($)',
            dataIndex: 'cost',
            key: 'cost',
        },
    ];

    const bestModel = modelData.reduce((prev, current) =>
        (prev.score > current.score) ? prev : current
    );

    return (
        <div>
            <Card title="Best Model Overview">
                <p><strong>Model:</strong> {bestModel.model}</p>
                <p><strong>Preference Score:</strong> {bestModel.score}</p>
                <p><strong>Confidence Interval:</strong> {bestModel.confidence}</p>
            </Card>

            <Table columns={columns} dataSource={modelData} title={() => 'Performance Matrix'} />

            <Table columns={columns} dataSource={recentComparisons} title={() => 'Recent Comparisons'} />

            <Table columns={latencyColumns} dataSource={latencyData} title={() => 'Latency and Cost'} />
        </div>
    );
};

export default Results;
