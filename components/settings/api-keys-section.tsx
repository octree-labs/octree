'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsCard } from '@/components/settings/settings-card';
import { createApiKey, revokeApiKey, type ApiKeySummary } from '@/actions/api-keys';

const APP_URL = 'https://app.useoctree.com';

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy. Select the text and copy it manually.');
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        <CopyButton text={code} label={`Copy ${title}`} />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-neutral-950 px-4 py-3 text-xs leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Settings > Account: API keys for the compile API and MCP server (anchor #api-keys). */
export function ApiKeysSection({ initialKeys, maxKeys }: { initialKeys: ApiKeySummary[]; maxKeys: number }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const atLimit = keys.length >= maxKeys;
  const shownKey = newKey ?? '<your-api-key>';

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createApiKey(name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setKeys((current) => [result.summary, ...current]);
      setNewKey(result.key);
      setName('');
    });
  };

  const handleRevoke = (key: ApiKeySummary) => {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working.`)) return;
    startTransition(async () => {
      const result = await revokeApiKey(key.id);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not revoke the key.');
        return;
      }
      setKeys((current) => current.filter((k) => k.id !== key.id));
      toast.success('Key revoked');
    });
  };

  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open) setNewKey(null);
  };

  return (
    <div id="api-keys" className="scroll-mt-24">
      <SettingsCard
        title="API keys"
        description="Compile LaTeX from AI agents and scripts with the Octree API and MCP server. Free accounts get 30 compiles a day, Pro 1,000."
        action={
          <Button size="sm" variant="gradient" disabled={atLimit} onClick={() => setCreateOpen(true)}>
            <KeyRound />
            Create key
          </Button>
        }
      >
        {keys.length === 0 ? (
          <div className="px-6 py-4 text-sm text-neutral-500">No API keys yet.</div>
        ) : (
          keys.map((key) => (
            <div key={key.id || key.key_prefix} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{key.name}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  <code className="font-mono">{key.key_prefix}…</code> · Created {formatDate(key.created_at)} · Last
                  used {formatDate(key.last_used_at)}
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={isPending || !key.id}
                onClick={() => handleRevoke(key)}
                className="text-red-600 hover:text-red-700"
              >
                Revoke
              </Button>
            </div>
          ))
        )}
        <div className="space-y-4 px-6 py-5">
          <Snippet
            title="Use with Claude Code"
            code={`claude mcp add --transport http octree ${APP_URL}/api/mcp --header "Authorization: Bearer ${shownKey}"`}
          />
          <Snippet
            title="REST API"
            code={`curl ${APP_URL}/api/v1/compile \\\n  -H "Authorization: Bearer ${shownKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"latex": "\\\\documentclass{article}\\\\begin{document}Hello\\\\end{document}", "response": "pdf"}' \\\n  -o output.pdf`}
          />
        </div>
      </SettingsCard>

      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-[480px]">
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your API key</DialogTitle>
                <DialogDescription>
                  This is the only time the key is shown. Store it somewhere safe; if you lose it, revoke it and create a
                  new one.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input readOnly value={newKey} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <CopyButton text={newKey} label="Copy API key" />
              </div>
              <DialogFooter>
                <Button variant="gradient" onClick={() => closeCreate(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Name it after where it will be used, e.g. &quot;Claude Code&quot;.</DialogDescription>
              </DialogHeader>
              <div className="my-4 space-y-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Claude Code"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="submit" variant="gradient" disabled={isPending || !name.trim()}>
                  {isPending ? 'Creating…' : 'Create key'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
