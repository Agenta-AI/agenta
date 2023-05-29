import Link from 'next/link';

const Logo: React.FC = () => {

  return (
    <div style={{
      border: "1px solid black",
      padding: "10px",
      borderTopLeftRadius: 10,
      borderBottomRightRadius: 10
    }}>
      <Link href="/apps">
        <div style={{
          color: '#000',
          textDecoration: 'none',
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
