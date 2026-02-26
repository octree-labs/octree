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

interface SignInEmailProps {
  email: string;
  unsubscribeUrl: string;
}

export function SignInEmail({ email, unsubscribeUrl }: SignInEmailProps) {
  const time = new Date().toUTCString();

  return (
    <Html>
      <Head />
      <Preview>New sign-in to your Octree account</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={content}>
            <Text style={heading}>New sign-in detected</Text>

            <Text style={paragraph}>
              We noticed a new sign-in to your Octree account (<strong>{email}</strong>) at {time}.
            </Text>

            <Text style={paragraph}>
              If this was you, you can safely ignore this email.
            </Text>

            <Text style={paragraph}>
              If you didn't sign in, please change your password immediately to secure your account.
            </Text>

            <Section style={buttonContainer}>
              <Button href="https://app.useoctree.com/settings" style={button}>
                Secure your account
              </Button>
            </Section>

            <Text style={signer}>— The Octree Team</Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Security notification for {email}.{' '}
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
