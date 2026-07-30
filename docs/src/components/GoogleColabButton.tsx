import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './GoogleColabButton.module.css';

interface GoogleColabButtonProps {
  notebookPath: string;
  children?: React.ReactNode;
}

const GoogleColabButton: React.FC<GoogleColabButtonProps> = ({ notebookPath, children }) => {
  const baseUrl = 'https://colab.research.google.com/github/Agenta-AI/agenta/blob/main';
  const colabUrl = `${baseUrl}/${notebookPath}`;
  const logoUrl = useBaseUrl('/images/google_collab.png');

  return (
    <div className="margin-bottom--lg">
      <a
        href={colabUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.colabButton}
      >
        {/* Google Colab Logo */}
        <img
          src={logoUrl}
          alt="Google Colaboratory"
          className={styles.logo}
        />
        
        {/* Text - centered in the remaining space */}
        <span className={styles.text}>
          {children || 'Google Colaboratory'}
        </span>
        
        {/* Arrow */}
        <svg 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
          className={styles.arrow}
        >
          <polyline points="9,18 15,12 9,6"></polyline>
        </svg>
      </a>
    </div>
  );
};

export default GoogleColabButton;