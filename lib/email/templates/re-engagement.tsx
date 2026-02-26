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

interface ReEngagementEmailProps {
  email: string;
  unsubscribeUrl: string;
}

export function ReEngagementEmail({
  email,
  unsubscribeUrl,
}: ReEngagementEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Still interested in Octree?</Preview>
      <Body style={body}>
        <Container style={container}>


          <Section style={content}>
            <Text style={heading}>It's been a while 👋</Text>

            <Text style={paragraph}>
              You signed up for Octree but we haven't seen you since. We wanted to make sure everything was working smoothly for you.
            </Text>

            <Text style={paragraph}>
              If you ran into any issues or need a hand getting your first project set up — simply hit <strong>reply to this email</strong> and we'll be happy to help you get started.
            </Text>

            <Section style={buttonContainer}>
              <Button href="https://useoctree.online" style={button}>
                Create your first project
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
