import React, { useContext, useEffect, useRef, useState } from 'react';
import type { InputRef } from 'antd';
import { Button, Form, Input, Popconfirm, Table } from 'antd';
import type { FormInstance } from 'antd/es/form';

const EditableContext = React.createContext<FormInstance<any> | null>(null);

interface Item {
    key: string;
    name: string;
    age: string;
    address: string;
}

interface EditableRowProps {
    index: number;
}

const EditableRow: React.FC<EditableRowProps> = ({ index, ...props }) => {
    const [form] = Form.useForm();
    return (
        <Form form={form} component={false}>
            <EditableContext.Provider value={form}>
                <tr {...props} />
            </EditableContext.Provider>
        </Form>
    );
};

interface EditableCellProps {
    title: React.ReactNode;
    editable: boolean;
    children: React.ReactNode;
    dataIndex: keyof Item;
    record: Item;
    handleSave: (record: Item) => void;
}

const EditableCell: React.FC<EditableCellProps> = ({
    title,
    editable,
    children,
    dataIndex,
    record,
    handleSave,
    ...restProps
}) => {
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<InputRef>(null);
    const form = useContext(EditableContext)!;

    useEffect(() => {
        if (editing) {
            inputRef.current!.focus();
        }
    }, [editing]);

    const toggleEdit = () => {
        setEditing(!editing);
        form.setFieldsValue({ [dataIndex]: record[dataIndex] });
    };

    const save = async () => {
        try {
            const values = await form.validateFields();

            handleSave({ ...record, ...values });
            toggleEdit();
        } catch (errInfo) {
            console.log('Save failed:', errInfo);
        }
    };

    let childNode = children;

    if (editable) {
        childNode = editing ? (
            <Form.Item
                style={{ margin: 0 }}
                name={dataIndex}
                rules={[
                    {
                        required: true,
                        message: `${title} is required.`,
                    },
                ]}
            >
                <Input ref={inputRef} onPressEnter={save} onBlur={save} />
            </Form.Item>
        ) : (
            <div className="editable-cell-value-wrap" style={{ paddingRight: 24 }} onClick={toggleEdit}>
                {children}
            </div>
        );
    }

    return <td {...restProps}>{childNode}</td>;
};

type EditableTableProps = Parameters<typeof Table>[0];

interface DataType {
    key: React.Key;
    name: string;
    age: string;
    address: string;
}

type ColumnTypes = Exclude<EditableTableProps['columns'], undefined>;

const DynamicTestSetTable: React.FC = () => {
    const [columnCount, setColumnCount] = useState(3);
    const [rowCount, setRowCount] = useState(2);
    const [dataSource, setDataSource] = useState<DataType[]>([
        {
            key: '0',
            name: 'Edward King 0',
            age: '32',
            address: 'London, Park Lane no. 0',
        },
        {
            key: '1',
            name: 'Edward King 1',
            age: '32',
            address: 'London, Park Lane no. 1',
        },
    ]);

    function handleDelete(key: React.Key) {
        setDataSource((currentDataSource) => currentDataSource.filter((item) => item.key !== key));
    }

    const handleAddRow = () => {
        const newData: DataType = {
            key: `${rowCount}`,
            name: `Edward King ${rowCount}`,
            age: '32',
            address: `London, Park Lane no. ${rowCount}`,
        };
        // Include the new columns data
        columns.forEach((column, index) => {
            if (index >= 3) {
                newData[column.dataIndex as string] = 'new data';
            }
        });
        setDataSource([...dataSource, newData]);
        setRowCount(rowCount + 1);
    };

    const handleAddColumn = () => {
        setColumnCount((prevCount) => {
            const newCount = prevCount + 1;
            const newColumn = {
                title: `Column ${newCount}`,
                dataIndex: `column${newCount}`,
                editable: true,
                onCell: (record: DataType) => ({
                    record,
                    editable: true,
                    dataIndex: `column${newCount}`,
                    title: `Column ${newCount}`,
                    handleSave,
                }),
            };

            setColumns((prevColumns) => {
                const newColumns = [
                    ...prevColumns.slice(0, prevColumns.length - 1),
                    newColumn,
                    prevColumns[prevColumns.length - 1],
                ];
                return newColumns;
            });

            setDataSource((prevDataSource) => {
                const newDataSource = prevDataSource.map((item) => ({
                    ...item,
                    [`column${newCount}`]: 'new data',
                }));
                return newDataSource;
            });

            return newCount;
        });
    };

    const defaultColumns: (ColumnTypes[number] & { editable?: boolean; dataIndex: string })[] = [
        {
            title: 'name',
            dataIndex: 'name',
            width: '30%',
            editable: true,
        },
        {
            title: 'age',
            dataIndex: 'age',
            editable: true,
        },
        {
            title: 'address',
            dataIndex: 'address',
            editable: true,
        },
        {
            title: (
                <Button onClick={handleAddColumn}>
                    Add a column
                </Button>
            ),
            dataIndex: 'operation',
            render: (_, record: { key: React.Key }) =>
                dataSource.length >= 1 ? (
                    <Popconfirm title="Sure to delete?" onConfirm={() => handleDelete(record.key)}>
                        <a>Delete</a>
                    </Popconfirm>
                ) : null,
        },
    ];

    const handleSave = (row: DataType) => {
        setDataSource((currentDataSource) => {
            const newData = [...currentDataSource];
            const index = newData.findIndex((item) => row.key === item.key);
            const item = newData[index];
            newData.splice(index, 1, {
                ...item,
                ...row,
            });
            return newData;
        });
    };

    const components = {
        body: {
            row: EditableRow,
            cell: EditableCell,
        },
    };

    const [columns, setColumns] = useState(() => defaultColumns.map((col) => {
        if (!col.editable) {
            return col;
        }
        return {
            ...col,
            onCell: (record: DataType) => ({
                record,
                editable: col.editable,
                dataIndex: col.dataIndex,
                title: col.title,
                handleSave: handleSave,
            }),
        };
    }));

    const handleSaveTestSet = () => {
    }

    return (
        <div>
            <Table
                components={components}
                rowClassName={() => 'editable-row'}
                bordered
                dataSource={dataSource}
                columns={columns}
                // columns={columns as ColumnTypes}
                footer={() => (
                    <Button onClick={handleAddRow}>
                        Add a row
                    </Button>
                )}
            />
            <Button onClick={handleSaveTestSet} type="primary">
                Save Test Set
            </Button>
        </div>
    );
};

export default DynamicTestSetTable;
