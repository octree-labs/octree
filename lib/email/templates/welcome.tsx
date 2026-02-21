import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components';

interface WelcomeEmailProps {
  email: string;
  unsubscribeUrl: string;
}

export function WelcomeEmail({ email, unsubscribeUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Octree</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>Welcome to Octree 🌳</Text>
          <Text style={paragraph}>
            Your account is ready. Start writing LaTeX documents with AI
            assistance — create a project and let Octree handle the rest.
          </Text>
          <Button href="https://useoctree.online" style={button}>
            Open Octree →
          </Button>
          <Text style={paragraph}>— Basil</Text>
          <Hr style={hr} />
          <Text style={footer}>
            You're receiving this because you signed up with {email}.{' '}
            <Link href={unsubscribeUrl} style={footerLink}>
              Unsubscribe
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '40px 24px',
};

const heading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '600',
  color: '#111827',
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px',
};

const button: React.CSSProperties = {
  backgroundColor: '#000000',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  textDecoration: 'none',
  display: 'inline-block',
  margin: '0 0 24px',
};

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '24px 0',
};

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0',
};

const footerLink: React.CSSProperties = {
  color: '#9ca3af',
};
