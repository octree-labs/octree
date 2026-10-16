import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { ResumeTemplate } from './templates';

export const RESUME_MODEL = 'claude-sonnet-5-5';

const SYSTEM_PROMPT = `You convert resumes into LaTeX using a fixed template.

You will receive the candidate's resume (as a PDF) and a TEMPLATE: a complete example .tex file filled with placeholder data (Jane Doe).

Produce a complete .tex document that:
1. Keeps the template's preamble exactly as given (documentclass, packages, macro definitions, colors). Do not add packages.
2. Replaces ALL placeholder content with the candidate's content, using only the macros and environments that appear in the template.
3. Preserves every fact from the resume: every job, school, date, location, bullet, skill, project, award, certification, link, and number. Do not summarize, merge, or drop bullets.
4. Never invents anything: no new metrics, skills, titles, dates, or links. If the template has a field the resume lacks (e.g. GPA, location), leave it empty or omit that line.
5. Omits template sections the resume has no content for. For resume sections the template lacks (e.g. Certifications, Languages, Publications, Leadership), add a section in the same style as the template's existing sections.
6. Uses the resume's own section order where sensible.
7. Escapes LaTeX special characters in content: & % $ # _ { } ~ ^ \\ (e.g. "R&D" -> "R\\&D", "50%" -> "50\\%"). Wrap URLs in \\href{url}{display text}.
8. Replaces fancy Unicode (smart quotes, bullets, emoji, unusual symbols) with plain ASCII or LaTeX equivalents. Use -- for date ranges.

Output ONLY the .tex source. No markdown fences, no commentary.`;

const FIX_PROMPT = `You fix LaTeX compile errors in a resume. You receive the .tex source and the error log.
Fix only what is needed to compile. Do not change, add, or remove any resume content, and do not add packages.
Output ONLY the corrected .tex source. No markdown fences, no commentary.`;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:latex|tex)?\s*\n/, '')
    .replace(/\n```\s*$/, '')
    .trim();
}

export async function generateResumeTex(
  pdf: Uint8Array,
  template: ResumeTemplate
): Promise<string> {
  const { text } = await generateText({
    model: anthropic(RESUME_MODEL),
    system: SYSTEM_PROMPT,
    maxOutputTokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: pdf, mediaType: 'application/pdf' },
          {
            type: 'text',
            text: `TEMPLATE (compiled with ${template.engine}):\n\n${template.skeleton}`,
          },
        ],
      },
    ],
  });
  return stripFences(text);
}

export async function fixResumeTex(
  tex: string,
  errorLog: string
): Promise<string> {
  const { text } = await generateText({
    model: anthropic(RESUME_MODEL),
    system: FIX_PROMPT,
    maxOutputTokens: 16000,
    prompt: `ERROR LOG:\n${errorLog}\n\nSOURCE:\n${tex}`,
  });
  return stripFences(text);
}
