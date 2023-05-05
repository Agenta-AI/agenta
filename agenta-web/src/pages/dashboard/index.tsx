
import LLMCallsTable from '../../components/LLMCallsTable/LLMCallsTable';
import Navbar from '../../components/Navbar/Navbar';
import Sidebar from '../../components/Sidebar/Sidebar';

export default function Dashboard() {

  return (
    <div className="flex">
      {/* <Navbar /> */}
      <Sidebar />

      <div className="p-7">
        <LLMCallsTable />
      </div>
    </div>
  );
}
