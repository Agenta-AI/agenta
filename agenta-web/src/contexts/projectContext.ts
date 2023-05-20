// contexts/projectContext.ts
import { createContext } from 'react';

type ProjectContextType = {
    project: string;
    setProject: (value: string) => void;
};

const ProjectContext = createContext<ProjectContextType>({ project: '', setProject: () => { } });

export default ProjectContext;
