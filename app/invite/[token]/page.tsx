'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle, FileText } from 'lucide-react';

interface InvitationDetails {
  project_title: string;
  inviter_name: string;
  role: string;
  expires_at: string;
}

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [status, setStatus] = useState<'loading' | 'ready' | 'accepting' | 'success' | 'error'>('loading');
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvitation() {
      try {
        const response = await fetch(`/api/invitations/${token}`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Invalid invitation');
          setStatus('error');
          return;
        }

        setInvitation(data);
        setStatus('ready');
      } catch {
        setError('Failed to load invitation');
        setStatus('error');
      }
    }

    fetchInvitation();
  }, [token]);

  const handleAccept = async () => {
    setStatus('accepting');
    
    try {
      const response = await fetch(`/api/invitations/${token}/accept`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          // User needs to log in first
          router.push(`/auth/login?next=/invite/${token}`);
          return;
        }
        setError(data.error || 'Failed to accept invitation');
        setStatus('error');
        return;
      }

      setStatus('success');
      
      // Redirect to the project after a brief delay
      setTimeout(() => {
        router.push(`/projects/${data.project_id}`);
      }, 2000);
    } catch {
      setError('Failed to accept invitation');
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-10">
            <XCircle className="h-12 w-12 text-red-500" />
            <h2 className="mt-4 text-xl font-semibold">Invitation Error</h2>
            <p className="mt-2 text-center text-muted-foreground">{error}</p>
            <Button className="mt-6" onClick={() => router.push('/')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-10">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <h2 className="mt-4 text-xl font-semibold">Invitation Accepted!</h2>
            <p className="mt-2 text-center text-muted-foreground">
              You now have access to the project. Redirecting...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <FileText className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Project Invitation</CardTitle>
          <CardDescription>
            You&apos;ve been invited to collaborate
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invitation && (
            <>
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground">Project</p>
                <p className="font-medium">{invitation.project_title}</p>
              </div>
              
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground">Invited by</p>
                <p className="font-medium">{invitation.inviter_name}</p>
              </div>

              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground">Your role</p>
                <p className="font-medium capitalize">{invitation.role}</p>
              </div>

              <Button 
                className="w-full" 
                onClick={handleAccept}
                disabled={status === 'accepting'}
              >
                {status === 'accepting' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  'Accept Invitation'
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                By accepting, you&apos;ll be able to view and edit this project.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

