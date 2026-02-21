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

interface TrialStartedEmailProps {
  email: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
}

export function TrialStartedEmail({ email, trialEndsAt, unsubscribeUrl }: TrialStartedEmailProps) {
  const formattedDate = trialEndsAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Html>
      <Head />
      <Preview>Your Octree Pro trial has started</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>Your trial has started 🎉</Text>
          <Text style={paragraph}>
            You have full access to Octree Pro until {formattedDate}.
          </Text>
          <Text style={paragraph}>
            Use this time to explore AI-powered document generation, unlimited edits, and LaTeX
            compilation.
          </Text>
          <Button href="https://useoctree.online" style={button}>
            Open Octree →
          </Button>
          <Text style={paragraph}>
            You can cancel anytime from your{' '}
            <Link href="https://useoctree.online/settings" style={link}>
              settings
            </Link>{' '}
            before the trial ends.
          </Text>
          <Text style={paragraph}>— Basil</Text>
          <Hr style={hr} />
          <Text style={footer}>
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
  margin: '4px 0 20px',
};

const link: React.CSSProperties = {
  color: '#374151',
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
