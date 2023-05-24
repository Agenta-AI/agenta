
import { InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Form, Spin, Table, Upload, message } from "antd";
import { RcFile, UploadChangeParam } from "antd/es/upload";
import { useState, useEffect } from 'react';
import axios from 'axios';
import useSWR from 'swr'
import DatasetsTable from "./DatasetsTable";

export default function Datasets() {
    const [uploadLoading, setUploadLoading] = useState(false);

    const onFinish = async (values: any) => {
        const { file } = values;

        if (file && file.length > 0) {
            const formData = new FormData();
            formData.append('file', file[0].originFileObj);

            try {
                setUploadLoading(true);
                const response = await axios.post('http://localhost/api/datasets/upload', formData);

                if (response.status === 200) {
                    // File uploaded successfully
                    const data = response.data;
                    console.log('Uploaded file:', data);
                    setUploadLoading(false); // Set loading state to false after successful upload
                } else {
                    // Handle error
                    console.error('Failed to upload file:', response.status);
                    setUploadLoading(false); // Set loading state to false after failed upload
                }
            } catch (error) {
                console.error('Error uploading file', error);
            }
        };
    };

    return (
        <div>
            <Spin spinning={uploadLoading}>
                <Form onFinish={onFinish}>
                    <Form.Item name="file" valuePropName="fileList" getValueFromEvent={(e) => e.fileList}>
                        <Upload.Dragger name="file" accept=".csv" multiple={false}>
                            <p className="ant-upload-drag-icon">
                                <UploadOutlined />
                            </p>
                            <p className="ant-upload-text">Click or drag a CSV file to this area to upload</p>
                        </Upload.Dragger>
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit">
                            Upload
                        </Button>
                    </Form.Item>
                </Form>
            </Spin>

            <DatasetsTable/>
        </div>


    );
}
