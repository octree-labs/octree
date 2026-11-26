'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/settings/settings-card';
import { revokeOAuthGrant, type OAuthGrantSummary } from '@/actions/oauth-grants';

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function grantLabel(grant: OAuthGrantSummary): string {
  return grant.client_name ?? grant.client_host ?? 'Unnamed app';
}

/** Settings > Account: apps connected with OAuth ("Allow Octree"), anchor #connected-apps. */
export function ConnectedAppsSection({ initialGrants, maxGrants }: { initialGrants: OAuthGrantSummary[]; maxGrants: number }) {
  const [grants, setGrants] = useState(initialGrants);
  const [isPending, startTransition] = useTransition();

  const handleRevoke = (grant: OAuthGrantSummary) => {
    if (!window.confirm(`Disconnect "${grantLabel(grant)}"? It loses access within a minute and has to be connected again.`)) return;
    startTransition(async () => {
      const result = await revokeOAuthGrant(grant.id);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not disconnect the app.');
        return;
      }
      setGrants((current) => current.filter((g) => g.id !== grant.id));
      toast.success('App disconnected');
    });
  };

  return (
    <div id="connected-apps" className="scroll-mt-24">
      <SettingsCard
        title="Connected apps"
        description={`Apps you allowed to compile LaTeX with your account (Claude, ChatGPT, Cursor, VS Code...). They cannot see your projects. Up to ${maxGrants}.`}
      >
        {grants.length === 0 ? (
          <div className="px-6 py-4 text-sm text-neutral-500">
            No connected apps. Add <code className="font-mono">https://app.useoctree.com/api/mcp</code> as an MCP server in
            your app and sign in.
          </div>
        ) : (
          grants.map((grant) => (
            <div key={grant.id} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{grantLabel(grant)}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {grant.client_kind === 'cimd' && grant.client_host ? <>{grant.client_host} · </> : null}
                  Connected {formatDate(grant.created_at)} · Last active {formatDate(grant.last_refreshed_at ?? grant.created_at)}
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={isPending}
                onClick={() => handleRevoke(grant)}
                className="text-red-600 hover:text-red-700"
              >
                Disconnect
              </Button>
            </div>
          ))
        )}
      </SettingsCard>
    </div>
  );
}
