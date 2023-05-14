
import { useState, useEffect } from 'react';

export default function LLMCallsTable() {
  const [data, setData] = useState<any[]>([]);
  const [tableRows, setTableRows] = useState<any[]>([]);
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true)
    fetch('http://127.0.0.1:3030/api/llm-calls', {
      headers: {
        "Content-Type": "application/json",
      }
    })
      .then((res) => res.json())
      .then((data) => {
        setTableRows(data)
        setLoading(false)
      })
  }, [])

  if (isLoading) return <div>Loading...</div>
  if (!tableRows) return <div>No data</div>
  if (tableRows.length && tableRows.length === 0) return <div>No data</div>
  else if (!tableRows.length) return <div>No data</div>

  const TABLE_HEAD = ["Output", "Prompt", "Params"];

  return (
    <div className="">
      <h1 className="text-2xl font-semibold pb-10">Logs</h1>

      <table className="w-full table-auto text-left">
        <thead>
          <tr>
            {TABLE_HEAD.map((head) => (
              <th key={head} className="border-b border-blue-gray-100 bg-blue-gray-50 p-4">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((tableItem, index) => {
            const isLast = index === tableRows.length - 1;
            const classes = isLast ? "p-4" : "p-4 border-b border-blue-gray-50 ";
            return (
              <tr key={index} >
                <td className={classes}>
                  {tableItem.output}
                </td>
                <td className={classes}>
                  {tableItem.prompt}
                </td>
                <td className={classes}>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

    </div>
  );
}
