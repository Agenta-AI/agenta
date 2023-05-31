import { Table } from 'antd';

const EmptyEvaluationTable = () => {
    const columns = [
        {
            key: '1',
            title: 'Inputs'
        },
        {
            key: '2',
            title: 'App Variant 1'
        },
        {
            key: '3',
            title: 'App Variant 2'
        },
        {
            key: '4',
            title: 'Evaluate'
        }
    ]

    const rows: any = [];

    return (
        <Table
            dataSource={rows}
            columns={columns}
            pagination={false}
            rowClassName={() => 'editable-row'}
        />
    );
};

export default EmptyEvaluationTable;