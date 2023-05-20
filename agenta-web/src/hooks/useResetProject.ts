// hooks/useResetProject.ts
import { useContext } from 'react';
import { useRouter } from 'next/router';
import ProjectContext from '@/contexts/projectContext';

const useResetProject = () => {
    const router = useRouter();
    const { setProject } = useContext(ProjectContext);

    const resetProject = () => {
        setProject('');
        router.push('/');
    }

    return resetProject;
};

export default useResetProject;
