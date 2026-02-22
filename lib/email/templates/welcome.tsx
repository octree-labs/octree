import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
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
          <Section style={content}>
            <Text style={heading}>Welcome aboard!</Text>
            <Text style={paragraph}>
              Your account is ready. Octree brings AI assistance to LaTeX writing, letting you focus on your ideas instead of syntax.
            </Text>

            <Text style={paragraph}>
              Here's how to get started:
            </Text>

            <Text style={listItem}>• Create your first project</Text>
            <Text style={listItem}>• Let AI generate or refine your equations</Text>
            <Text style={listItem}>• Compile directly to PDF</Text>

            <Section style={buttonContainer}>
              <Button href="https://useoctree.online" style={button}>
                Open your dashboard
              </Button>
            </Section>

            <Text style={signer}>— The Octree Team</Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Sent to {email}.{' '}
              <Link href={unsubscribeUrl} style={footerLink}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '40px 0',
};

const container: React.CSSProperties = {
  maxWidth: '480px',
  margin: '0 auto',
};



const content: React.CSSProperties = {
  padding: '0',
};

const heading: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: '600',
  color: '#0a0a0a',
  letterSpacing: '-0.5px',
  margin: '0 0 16px',
};

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#52525b',
  margin: '0 0 16px',
};

const listItem: React.CSSProperties = {
  fontSize: '15px',
  color: '#52525b',
  margin: '8px 0',
};

const buttonContainer: React.CSSProperties = {
  marginTop: '24px',
  marginBottom: '24px',
};

const button: React.CSSProperties = {
  backgroundColor: '#1E66FF',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
};

const signer: React.CSSProperties = {
  fontSize: '15px',
  color: '#52525b',
  margin: '0',
  paddingTop: '32px',
};

const footer: React.CSSProperties = {
  padding: '48px 0 0',
};

const footerText: React.CSSProperties = {
  fontSize: '13px',
  color: '#a1a1aa',
  margin: '0',
};

const footerLink: React.CSSProperties = {
  color: '#71717a',
  textDecoration: 'underline',
};
