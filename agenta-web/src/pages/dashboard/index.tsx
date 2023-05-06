
import LLMCallsTable from '../../components/LLMCallsTable/LLMCallsTable';
import Navbar from '../../components/Navbar/Navbar';
import Sidebar from '../../components/Sidebar/Sidebar';
import Header from '../../components/Header/Header';
import { Card, Text, Metric, Flex, ProgressBar } from "@tremor/react";

export default function Dashboard() {

  return (

    <div className='flex flex-col min-h-screen'>
      <Header />

      {/* <Navbar /> */}
      <div className="flex flex-1">
        <Sidebar />
        <LLMCallsTable />
      </div>
    </div>
  );
}
