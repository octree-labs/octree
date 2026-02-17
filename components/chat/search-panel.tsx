'use client';

import { useState } from 'react';
import { Search, Loader2, ExternalLink, Calendar, User, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  snippet: string;
}

function generateBibTeX(result: SearchResult): string {
  const year = result.publishedDate
    ? new Date(result.publishedDate).getFullYear()
    : new Date().getFullYear();

  let keyPrefix: string;
  if (result.author) {
    const firstAuthor = result.author.split(/,|\band\b/)[0].trim();
    const lastNameMatch = firstAuthor.match(/\S+$/);
    keyPrefix = lastNameMatch ? lastNameMatch[0] : firstAuthor;
  } else {
    const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'to', 'with']);
    keyPrefix = result.title
      .split(/\s+/)
      .find((w) => !stopWords.has(w.toLowerCase()))
      ?.replace(/[^a-zA-Z]/g, '') || 'ref';
  }
  const citeKey = `${keyPrefix.toLowerCase()}${year}`;

  const lines = [
    `@article{${citeKey},`,
    `  title  = {${result.title}},`,
  ];
  if (result.author) lines.push(`  author = {${result.author}},`);
  lines.push(`  year   = {${year}},`);
  lines.push(`  url    = {${result.url}},`);
  lines.push(`}`);

  return lines.join('\n');
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    setIsSearching(true);
    setError(null);
    setHasSearched(true);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Search failed');
      }

      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={handleSearch} className="flex-shrink-0 border-b border-slate-200 p-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search research papers..."
            className="h-8 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="gradient"
            disabled={isSearching || !query.trim()}
            className="h-8 px-3"
          >
            {isSearching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300">
        {!hasSearched && (
          <div className="flex h-full flex-col items-center justify-center space-y-3 px-4 text-center">
            <Search className="h-8 w-8 text-slate-300" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-600">Search Papers</p>
              <p className="text-xs text-slate-400">
                Find research papers and references for your document
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {hasSearched && !isSearching && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-slate-500">No results found</p>
            <p className="text-xs text-slate-400">Try a different search query</p>
          </div>
        )}

        {isSearching && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <p className="mt-2 text-xs text-slate-500">Searching papers...</p>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="space-y-2">
            {results.map((result, i) => (
              <div
                key={i}
                className="group rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/50"
              >
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-1.5 flex items-start justify-between gap-2"
                >
                  <h4 className="text-sm font-medium leading-snug text-slate-800 group-hover:text-blue-700">
                    {result.title}
                  </h4>
                  <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400 group-hover:text-blue-500" />
                </a>

                {result.snippet && (
                  <p className="mb-2 line-clamp-3 text-xs leading-relaxed text-slate-500">
                    {result.snippet}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  {result.author && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {result.author}
                    </span>
                  )}
                  {formatDate(result.publishedDate) && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(result.publishedDate)}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      const bibtex = generateBibTeX(result);
                      await navigator.clipboard.writeText(bibtex);
                      setCopiedIndex(i);
                      toast.success('BibTeX copied to clipboard');
                      setTimeout(() => setCopiedIndex(null), 2000);
                    }}
                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
                  >
                    {copiedIndex === i ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Cite
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
