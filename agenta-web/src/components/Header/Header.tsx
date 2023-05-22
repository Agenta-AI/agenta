// components/Header/Header.tsx
import { Layout, Breadcrumb, Avatar, theme, Row, Col } from 'antd';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Logo from './Logo'; // create this component to display your logo
import { useContext } from 'react';
import ProjectContext from '@/contexts/projectContext';
import useResetProject from '@/hooks/useResetProject';
type User = {
  name: string;
  avatar: string;
};

type HeaderProps = {
  user: User;
};

const { Header } = Layout;

const AppHeader: React.FC<HeaderProps> = ({ user }) => {
  const resetProject = useResetProject();
  // get the project name from the current route
  const projectName = useContext(ProjectContext);

  return (
    <Header style={{ background: '#ffffff', }} >
      <div style={{paddingTop: 30}}>
        <Breadcrumb items={[
          {
            title: <Link href="/" onClick={resetProject}>
              / projects
            </Link>,
          },
          {
            title: <Link href="/playground">
              {projectName.project}
            </Link>,
            key: 'projectName',
          },

        ]} />
      </div>
    </Header >
  );
};

export default AppHeader;
