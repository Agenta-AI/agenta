// components/Logo/Logo.tsx
import logoWhiteMode from '../../assets/logo-light-small.png'
import Image from 'next/image';
import Link from 'next/link';
import useResetProject from '@/hooks/useResetProject';


const Logo: React.FC = () => {
    const resetProject = useResetProject();
    return (
        <div>

            <Link href="/" onClick={resetProject}>
                <div style={{
                    color: '#000',
                    textDecoration: 'none',
                    fontSize: '1.5em',
                    fontWeight: 'bold'
                }}>
                    Agenta
                </div>
            </Link >


        </div >
    );
};

export default Logo;
