import Link from 'next/link';

const Logo: React.FC = () => {

    return (
        <div style={{

            padding: "10px",

        }}>
            <Link href="/apps">
                <img src="https://github.com/Agenta-AI/agenta/agenta-web/src/assets/light-complete-transparent-CROPPED.png" alt="Agenta Logo" />
            </Link >
        </div >
    );
};

export default Logo;
