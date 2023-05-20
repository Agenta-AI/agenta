// main _app.tsx
import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import { useState } from 'react';
import Layout from '@/components/Layout/Layout';
import ProjectContext from '@/contexts/projectContext';

export default function App({ Component, pageProps }: AppProps) {
  const [project, setProject] = useState('');

  return (
    <ProjectContext.Provider value={{ project, setProject }}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </ProjectContext.Provider>
  );
}
