
import { UploadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select, Spin, Upload, message } from "antd";
import { useState } from 'react';
import DatasetsTable from "./DatasetsTable";
import { Dataset } from "@/lib/Types";
import Link from "next/link";
import { useRouter } from "next/router";

export default function Datasets() {
    const router = useRouter();
    const [dataset, setDataset] = useState<Dataset>({
        id: '1',
        name: 'Example Dataset',
    });

    return (
        <div>
            <div style={{ marginBottom: 40 }}>
                <Link href={`${router.asPath}/new`}>
                    <Button >Add a dataset</Button>
                </Link>
            </div>

            <DatasetsTable dataset={dataset} />
        </div>


    );
}
