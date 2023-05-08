
import { log } from 'console';
import { useState, useEffect } from 'react';

export default function LLMCallsTable() {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('http://127.0.0.1:3030/api/llm-calls', {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {
        setData(data)
        setLoading(false)
      })
  }, [])

  if (isLoading) return <div>Loading...</div>
  if (!data) return <div>No data</div>
  if (data.length && data.length === 0) return <div>No data</div>
  else if (!data.length) return <div>No data</div>

  return (
    <div>
      <h1 className="text-2xl font-semibold pb-10">LLM Calls</h1>

      <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-200">
            <tr>
              <th scope="col" className="px-6 py-3">
                Output
              </th>
              <th scope="col" className="px-6 py-3">
                Prompt
              </th>
              <th scope="col" className="px-6 py-3">
                Params
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr className="bg-white" key={`tr-${item.id}`} >
                <td className="px-6 py-4">{item.output}</td>
                <td className="px-6 py-4">{item.prompt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
