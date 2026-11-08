import { describe, it, expect } from 'vitest';
import { classifyGenerationEnd, extractLatex } from '@/lib/generate/output';
import {
  checkGenerateRequestSize,
  MAX_ATTACHMENT_BYTES,
  REQUEST_BODY_LIMIT_BYTES,
} from '@/lib/generate/limits';

const DOC = '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}';
const MB = 1024 * 1024;

describe('extractLatex', () => {
  it('returns a bare document', () => {
    expect(extractLatex(DOC)).toBe(DOC);
  });

  it('unwraps a fenced document and drops surrounding prose', () => {
    expect(extractLatex(`Here you go:\n\`\`\`latex\n${DOC}\n\`\`\`\nEnjoy`)).toBe(DOC);
  });

  it('trims text after \\end{document}', () => {
    expect(extractLatex(`${DOC}\n\nLet me know if you want changes.`)).toBe(DOC);
  });

  it('returns null when \\end{document} never arrived', () => {
    expect(extractLatex('\\documentclass{article}\\begin{document}Stochastic Gradient')).toBeNull();
  });
});

describe('classifyGenerationEnd', () => {
  const partial = '\\documentclass{article}\\begin{document}\\section{Intro} The method';

  it('is complete whenever a whole document came back, whatever the stop reason', () => {
    expect(classifyGenerationEnd({ content: DOC, stopReason: 'end_turn', timedOut: false })).toEqual({
      kind: 'complete',
      latex: DOC,
    });
    expect(classifyGenerationEnd({ content: DOC, stopReason: 'max_tokens', timedOut: false }).kind).toBe(
      'complete'
    );
  });

  it('is truncated when the output cap cut the document off', () => {
    expect(classifyGenerationEnd({ content: partial, stopReason: 'max_tokens', timedOut: false })).toEqual({
      kind: 'truncated',
    });
  });

  it('is truncated when the route deadline stopped the stream', () => {
    expect(classifyGenerationEnd({ content: partial, stopReason: null, timedOut: true }).kind).toBe(
      'truncated'
    );
  });

  it('is invalid when the model finished without writing a document', () => {
    expect(
      classifyGenerationEnd({ content: 'Sorry, I cannot help.', stopReason: 'end_turn', timedOut: false })
    ).toEqual({ kind: 'invalid' });
  });
});

describe('checkGenerateRequestSize', () => {
  it('keeps base64 attachments plus headroom under the platform body limit', () => {
    expect(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4).toBeLessThan(REQUEST_BODY_LIMIT_BYTES);
    expect(MAX_ATTACHMENT_BYTES).toBe(3 * MB);
  });

  it('accepts a prompt with no attachments', () => {
    expect(checkGenerateRequestSize({ promptLength: 500, attachmentSizes: [] }).ok).toBe(true);
  });

  it('accepts attachments right at the limit', () => {
    expect(
      checkGenerateRequestSize({ promptLength: 200, attachmentSizes: [MAX_ATTACHMENT_BYTES] }).ok
    ).toBe(true);
  });

  it('refuses attachments that pass the old 5 MB check but not the platform, naming both sizes', () => {
    const result = checkGenerateRequestSize({ promptLength: 200, attachmentSizes: [2 * MB, 2.2 * MB] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('4.2 MB');
      expect(result.message).toContain('3.0 MB');
      expect(result.message).toMatch(/Remove a file/);
    }
  });

  it('refuses a request whose text pushes it over the body limit', () => {
    const result = checkGenerateRequestSize({
      promptLength: 100_000,
      currentLatexLength: 200_000,
      attachmentSizes: [MAX_ATTACHMENT_BYTES],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Shorten the prompt/);
  });
});
