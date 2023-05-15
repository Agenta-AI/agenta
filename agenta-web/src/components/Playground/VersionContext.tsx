// VersionContext.tsx

import React, { createContext, useState, useContext } from 'react';

type VersionState = {
    parameters: any;
    chat: any;
};

type VersionContextType = {
    versionState: Record<string, VersionState>;
    setVersionState: React.Dispatch<React.SetStateAction<Record<string, VersionState>>>;
};

const VersionContext = createContext<VersionContextType | undefined>(undefined);

export const VersionProvider: React.FC = ({ children }) => {
    const [versionState, setVersionState] = useState<Record<string, VersionState>>({});

    return (
        <VersionContext.Provider value={{ versionState, setVersionState }}>
            {children}
        </VersionContext.Provider>
    );
};

export const useVersionContext = () => {
    const context = useContext(VersionContext);
    if (context === undefined) {
        throw new Error('useVersionContext must be used within a VersionProvider');
    }
    return context;
};
