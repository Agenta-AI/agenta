import React, { FunctionComponent } from 'react';

interface SidebarItemProps {
    label: string;
    count?: number | string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ label, count }) => {
    return (
        <li className="flex w-full justify-between text-gray-600 hover:text-gray-500 cursor-pointer items-center mb-6">
            <div className="flex items-center">
                <span className="text-xl">{label}</span>
            </div>
            {count !== undefined && (
                <div className="py-1 px-3 bg-gray-700 rounded text-gray-500 flex items-center justify-center text-xs">
                    {count}
                </div>
            )}
        </li>
    );
};

export default SidebarItem;
