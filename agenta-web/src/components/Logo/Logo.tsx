import Link from 'next/link';

const Logo: React.FC = () => {

    return (
        <div style={{

            padding: "10px",

        }}>
            <Link href="/apps">
                <div style={{
                    color: '#000',
                    fontSize: '2em',
                    fontWeight: 'bold'
                }}>
                    Agenta
                </div>
            </Link >
        </div >
    );
};

export default Logo;
