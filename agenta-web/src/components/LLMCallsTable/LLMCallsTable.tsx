
import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Text,
  Title,
  Badge,
} from "@tremor/react";


export default function LLMCallsTable() {
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

  if (isLoading) return <div>Loading...</div>
  if (!data) return <div>No data</div>
  if (data.length && data.length === 0) return <div>No data</div>
  else if (!data.length) return <div>No data</div>

  return (
    <div className='h-full w-full'>
      <div className=" px-7 ">
        <div>
          <nav className="bg-white dark:bg-gray-700">
            <div className="max-w-screen-xl px-4 py-3 mx-auto">
              <div className="flex items-center">
                <ul className="flex flex-row font-medium mt-0 mr-6 space-x-20 text-sm">
                  <li>
                    <a href="#" className="text-gray-900 dark:text-white hover:underline" aria-current="page">V1</a>
                  </li>
                  <li>
                    <a href="#" className="text-gray-900 dark:text-white hover:underline">V2</a>
                  </li>
                  <li>
                    <a href="#" className="text-gray-900 dark:text-white hover:underline">V3</a>
                  </li>
                  <li>
                    <a href="#" className="text-gray-900 dark:text-white hover:underline">V4</a>
                  </li>
                </ul>
              </div>
            </div>
          </nav>
        </div>

        <div className='py-7'>
          <Card className="flex-grow w-full">
            <Title className='text-2xl'>Calls</Title>
            <Table className="mt-5">
              <TableHead>
                <TableRow className='text-xl'>
                  <TableHeaderCell>Prompt</TableHeaderCell>
                  <TableHeaderCell>Ouput</TableHeaderCell>
                  <TableHeaderCell>Parameters</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell>
                      <Text className='text-xl'>{item.prompt}</Text>
                    </TableCell>
                    <TableCell>
                      <Text className='text-xl'>{item.output}</Text>
                    </TableCell>
                    <TableCell>
                      <Text className='text-xl'>{item.params}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

    </div >
  );
}