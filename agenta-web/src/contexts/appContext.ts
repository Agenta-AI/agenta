// contexts/appContext.ts
import { createContext } from 'react';

type AppContextType = {
    app: string;
    setApp: (value: string) => void;
};

const AppContext = createContext<AppContextType>({ app: '', setApp: () => { } });

export default AppContext;
