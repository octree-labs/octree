'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Users,
  Link as LinkIcon,
  Mail,
  Copy,
  Check,
  Loader2,
  Trash2,
  Crown,
  UserPlus,
  RefreshCw,
} from 'lucide-react';
import { useProject } from '@/stores/project';
import type { Collaborator, ProjectInvitation } from '@/types/collaboration';
import { getUserColor } from '@/types/collaboration';

interface CollaboratorWithDetails extends Collaborator {
  email?: string;
  name?: string;
}

export function ShareDialog() {
  const project = useProject();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorWithDetails[]>([]);
  const [pendingInvites, setPendingInvites] = useState<ProjectInvitation[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const fetchCollaborators = async () => {
    if (!project?.id) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/collaborators`);
      const data = await response.json();

      if (response.ok) {
        setCollaborators(data.collaborators || []);
        setIsOwner(data.is_owner);
        setOwnerId(data.owner_id);
      }
    } catch (error) {
      console.error('Error fetching collaborators:', error);
    }
  };

  const fetchPendingInvites = async () => {
    if (!project?.id || !isOwner) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/invite`);
      const data = await response.json();

      if (response.ok) {
        setPendingInvites(data.invitations || []);
      }
    } catch (error) {
      console.error('Error fetching invites:', error);
    }
  };

  const fetchShareLink = async () => {
    if (!project?.id || !isOwner) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/share-link`);
      const data = await response.json();

      if (response.ok && data.url) {
        setShareLink(data.url);
      }
    } catch (error) {
      console.error('Error fetching share link:', error);
    }
  };

  useEffect(() => {
    if (open && project?.id) {
      fetchCollaborators();
    }
  }, [open, project?.id]);

  useEffect(() => {
    if (open && isOwner) {
      fetchPendingInvites();
      fetchShareLink();
    }
  }, [open, isOwner]);

  const handleSendInvite = async () => {
    if (!email.trim() || !project?.id) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || 'Failed to send invitation');
        return;
      }

      toast.success(`Invitation sent to ${email}`);
      setEmail('');
      fetchPendingInvites();
    } catch (error) {
      toast.error('Failed to send invitation');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateLink = async () => {
    if (!project?.id) return;

    setIsGeneratingLink(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/share-link`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || 'Failed to generate link');
        return;
      }

      setShareLink(data.url);
      if (data.existing) {
        toast.info('Using existing share link');
      } else {
        toast.success('Share link generated');
      }
    } catch (error) {
      toast.error('Failed to generate link');
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;

    try {
      await navigator.clipboard.writeText(shareLink);
      setIsCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const handleRevokeLink = async () => {
    if (!project?.id) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/share-link`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setShareLink(null);
        toast.success('Share link revoked');
      }
    } catch (error) {
      toast.error('Failed to revoke link');
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!project?.id) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/collaborators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        toast.success('Collaborator removed');
        fetchCollaborators();
      }
    } catch (error) {
      toast.error('Failed to remove collaborator');
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!project?.id) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/invite`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId }),
      });

      if (response.ok) {
        toast.success('Invitation revoked');
        fetchPendingInvites();
      }
    } catch (error) {
      toast.error('Failed to revoke invitation');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Project</DialogTitle>
          <DialogDescription>
            Invite others to collaborate on this project
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="people" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="people" className="gap-2">
              <Users className="h-4 w-4" />
              People
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <LinkIcon className="h-4 w-4" />
              Share Link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="space-y-4 pt-4">
            {/* Invite by email */}
            {isOwner && (
              <div className="space-y-2">
                <Label htmlFor="email">Invite by email</Label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
                  />
                  <Button onClick={handleSendInvite} disabled={isLoading || !email.trim()}>
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Current collaborators */}
            <div className="space-y-2">
              <Label>Collaborators</Label>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {collaborators.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No collaborators yet
                  </p>
                ) : (
                  collaborators.map((collab) => (
                    <div
                      key={collab.id}
                      className="flex items-center justify-between rounded-md p-2 hover:bg-muted"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white"
                          style={{ backgroundColor: getUserColor(collab.user_id) }}
                        >
                          {(collab.email || collab.name || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {collab.name || collab.email || 'Unknown user'}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {collab.role}
                          </p>
                        </div>
                      </div>
                      {collab.role === 'owner' ? (
                        <Crown className="h-4 w-4 text-amber-500" />
                      ) : isOwner ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCollaborator(collab.user_id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pending invitations */}
            {isOwner && pendingInvites.length > 0 && (
              <div className="space-y-2">
                <Label>Pending Invitations</Label>
                <div className="space-y-2 rounded-md border p-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between rounded-md p-2 hover:bg-muted"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{invite.email || 'Share link invite'}</p>
                          <p className="text-xs text-muted-foreground">Pending</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeInvite(invite.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="link" className="space-y-4 pt-4">
            {isOwner ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Anyone with the link can join as an editor. The link expires in 7 days.
                </p>

                {shareLink ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input value={shareLink} readOnly className="font-mono text-xs" />
                      <Button variant="outline" size="icon" onClick={handleCopyLink}>
                        {isCopied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleRevokeLink}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Revoke Link
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleGenerateLink}
                        disabled={isGeneratingLink}
                      >
                        {isGeneratingLink ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        New Link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={handleGenerateLink}
                    disabled={isGeneratingLink}
                  >
                    {isGeneratingLink ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LinkIcon className="mr-2 h-4 w-4" />
                    )}
                    Generate Share Link
                  </Button>
                )}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Only the project owner can generate share links
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

