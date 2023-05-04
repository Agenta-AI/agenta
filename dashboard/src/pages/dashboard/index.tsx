
import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/api/fetch-llm-calls')
      .then((res) => res.json())
      .then((data) => {
        console.log(data);
        setData(data)
        setLoading(false)
      })
  }, [])

  if (isLoading) return <p>Loading...</p>
  if (!data) return <p>No data</p>

  return (
    <div>
      <h1>LLM Calls</h1>
      <ul>
        {data.map((item) => (
          <li key={item._id}>
            <div>{item.output}</div>
            <div>{item.prompt}</div>
            <div>{item.params}</div>
          </li>
          
        ))}
      </ul>
    </div>
  );
}
