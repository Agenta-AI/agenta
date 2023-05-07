
import { useState, useEffect } from 'react';

export default function Sidebar() {
  const [isLoading, setLoading] = useState(false);

  // if (isLoading) return <p>Loading...</p>;

  const menu = [
    { title: "LLM Calls"},
    {
      title: "Retrievals", submenu: true,
      subMenuItems: [
        { title: "One" },
        { title: "Two" },
        { title: "Three" },
      ]
    },
  ];

  return (
    <div className="bg-teal-800 h-screen p-5 pt-8 w-72">
        <div className="inline-flex">
          <h1 className="text-white text-2xl">Agenta</h1>
        </div>

        <ul className="pt-2">
          {menu.map((item, index) => (
            <li key={index} className="text-gray-200 text-sm flex items-center gap-x-4 cursor-pointer p-2 hover:bg-teal-700 rounded-md mt-2">
              <span>
                {item.title}
              </span>
            </li>
          ))}
        </ul>
      </div>
  );
}