import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import { Divider, Radio, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';

export default function LLMCallsTable() {
    const [data, setData] = useState<any[]>([]);
    const [tableRows, setTableRows] = useState<any[]>([]);
    const [isLoading, setLoading] = useState(false);
    const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
    const columns = [
        {
            title: 'Output',
            dataIndex: 'output',
        },
        {
            title: 'Prompt',
            dataIndex: 'prompt',
        },
        {
            title: 'Params',
            dataIndex: 'params',
        },
    ];

    const mockData = [
        { output: "Engaging Social Media Post", prompt: "Create a social media post for our Product: XYZ, Platform: Instagram", params: "Product: XYZ, Platform: Instagram" },
        { output: "Informative Blog Post", prompt: "Create a social media post for our Service: ABC, Word Count: 1000", params: "Service: ABC, Word Count: 1000" },
        { output: "Persuasive Email Campaign", prompt: "Create a social media post for our Sale: 50% off, Audience: Existing Customers", params: "Sale: 50% off, Audience: Existing Customers" },
        { output: "Interactive Infographic", prompt: "Design an infographic for our Topic: Trends in Technology, Platform: Website", params: "Topic: Trends in Technology, Platform: Website" },
        { output: "Compelling Video Ad", prompt: "Create a video ad for our Product: ABC, Duration: 30 seconds", params: "Product: ABC, Duration: 30 seconds" },
        { output: "Engaging Newsletter", prompt: "Write a newsletter for our Subscribers: 10,000, Topic: Latest Industry Updates", params: "Subscribers: 10,000, Topic: Latest Industry Updates" },
        { output: "Captivating Presentation", prompt: "Prepare a presentation for our Event: Conference, Audience: Professionals", params: "Event: Conference, Audience: Professionals" },
        { output: "Attention-Grabbing Banner Ad", prompt: "Design a banner ad for our Campaign: Summer Sale, Dimensions: 728x90 pixels", params: "Campaign: Summer Sale, Dimensions: 728x90 pixels" },
        { output: "Informative Whitepaper", prompt: "Write a whitepaper on our Topic: Future of Artificial Intelligence, Length: 10 pages", params: "Topic: Future of Artificial Intelligence, Length: 10 pages" },
        { output: "Compelling Radio Ad", prompt: "Create a radio ad for our Service: XYZ, Target Audience: Young Adults", params: "Service: XYZ, Target Audience: Young Adults" },
        { output: "Engaging Social Media Contest", prompt: "Organize a social media contest for our Product: ABC, Platform: Facebook", params: "Product: ABC, Platform: Facebook" },
        { output: "Interactive Quiz", prompt: "Create an interactive quiz for our Topic: History, Number of Questions: 20", params: "Topic: History, Number of Questions: 20" },
        { output: "Persuasive Sales Letter", prompt: "Write a sales letter for our Product: XYZ, Target Market: Small Businesses", params: "Product: XYZ, Target Market: Small Businesses" },
        { output: "Informative Podcast Episode", prompt: "Record a podcast episode on our Topic: Health and Wellness, Duration: 45 minutes", params: "Topic: Health and Wellness, Duration: 45 minutes" },
        { output: "Engaging Social Media Story", prompt: "Create a social media story for our Event: Product Launch, Platform: Snapchat", params: "Event: Product Launch, Platform: Snapchat" },
        { output: "Persuasive Print Ad", prompt: "Design a print ad for our Service: ABC, Publication: Magazine", params: "Service: ABC, Publication: Magazine" },
        { output: "Informative Webinar", prompt: "Host a webinar on our Topic: Digital Marketing Strategies, Duration: 1 hour", params: "Digital Marketing Strategies" }
        // ... add more data up to 20 items
    ];
    // useEffect(() => {
    //   setLoading(true)
    //   fetch('http://127.0.0.1:3030/api/llm-calls', {
    //     headers: {
    //       "Content-Type": "application/json",
    //     }
    //   })
    //     .then((res) => res.json())
    //     .then((data) => {
    //       setTableRows(data)
    //       setLoading(false)
    //     })
    // }, [])
    useEffect(() => {
        setLoading(true);
        // Load the mock data
        setTableRows(mockData);
        setLoading(false);
    }, []);

    //   useEffect(() => {
    //     setLoading(true);
    //     setTableRows(mockData);
    //     setLoading(false);
    //   }, []);

    //   // if (isLoading) return <div>Loading...</div>
    //   // if (!tableRows) return <div>No data</div>
    //   // if (tableRows.length && tableRows.length === 0) return <div>No data</div>
    //   // else if (!tableRows.length) return <div>No data</div>

    //   // const TABLE_HEAD = ["Output", "Prompt", "Params"];

    return (
        <div>
            {/* //       <h1 className="text-2xl font-semibold pb-10">Logs</h1> */}
            <Divider />
            <Table
                columns={columns}
                dataSource={tableRows}
            />
            {/* // =======

//       <table className="w-full table-auto text-left">
//         <thead>
//           <tr>
//             {TABLE_HEAD.map((head) => (
//               <th key={head} className="border-b border-blue-gray-100 bg-blue-gray-50 p-4">
//                 {head}
//               </th>
//             ))}
//           </tr>
//         </thead>
//         <tbody>
//           {tableRows.map((tableItem, index) => {
//             const isLast = index === tableRows.length - 1;
//             const classes = isLast ? "p-4" : "p-4 border-b border-blue-gray-50 ";
//             return (
//               <tr key={index} >
//                 <td className={classes}>
//                   {tableItem.output}
//                 </td>
//                 <td className={classes}>
//                   {tableItem.prompt}
//                 </td>
//                 <td className={classes}>
//                 </td>
//               </tr>
//             );
//           })}
//         </tbody>
//       </table>

// >>>>>>> main */}
        </div>
    );
};

