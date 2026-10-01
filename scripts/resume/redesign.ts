// Local redesign pipeline: resume PDF -> template .tex (via Claude) -> compiled PDF.
// Usage: npx tsx scripts/resume/redesign.ts <resume.pdf> [-t template1] [-o out/resume]

import { execFile } from 'child_process';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { parseArgs, promisify } from 'util';
import { loadEnvConfig } from '@next/env';
import { extractPdfText } from '@/lib/resume/extract-text';
import { extractLatexErrors, runRedesign, type CompileFn } from '@/lib/resume/pipeline';
import { DEFAULT_RESUME_TEMPLATE_ID, getResumeTemplate } from '@/lib/resume/templates';

loadEnvConfig(process.cwd());

const run = promisify(execFile);

function localCompiler(dir: string): CompileFn {
  return async (tex, template) => {
    await writeFile(path.join(dir, 'resume.tex'), tex);
    const engineFlag = template.engine === 'xelatex' ? '-xelatex' : '-pdf';
    try {
      await run(
        'latexmk',
        [engineFlag, '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'],
        { cwd: dir }
      );
      return { ok: true, pdf: new Uint8Array(await readFile(path.join(dir, 'resume.pdf'))) };
    } catch {
      const log = await readFile(path.join(dir, 'resume.log'), 'utf8').catch(() => '');
      return { ok: false, errors: extractLatexErrors(log) };
    }
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      template: { type: 'string', short: 't', default: DEFAULT_RESUME_TEMPLATE_ID },
      out: { type: 'string', short: 'o', default: 'out/resume' },
    },
  });

  const inputPdf = positionals[0];
  if (!inputPdf) {
    console.error('Usage: npx tsx scripts/resume/redesign.ts <resume.pdf> [-t template1] [-o out/resume]');
    process.exit(1);
  }

  const template = getResumeTemplate(values.template!);
  const outDir = path.resolve(values.out!, template.id);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const pdf = new Uint8Array(await readFile(inputPdf));
  const { text: sourceText, totalPages } = await extractPdfText(pdf);
  await writeFile(path.join(outDir, 'source.txt'), sourceText);
  console.log(`Input: ${totalPages} page(s), ${sourceText.split(/\s+/).length} words`);

  const start = Date.now();
  let stepStart = start;
  const result = await runRedesign({
    pdf,
    sourceText,
    template,
    compile: localCompiler(outDir),
    onProgress: ({ step, attempt }) => {
      const now = Date.now();
      console.log(`  +${((now - stepStart) / 1000).toFixed(1)}s  ${step}${attempt ? ` (attempt ${attempt})` : ''}`);
      stepStart = now;
    },
    onCompileFailed: async (attempt, tex, errors) => {
      console.log(errors.split('\n').slice(0, 3).map((l) => `        ${l}`).join('\n'));
      await writeFile(path.join(outDir, `resume.failed-${attempt}.tex`), tex);
    },
  });
  console.log(`  done in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);

  await writeFile(path.join(outDir, 'coverage.json'), JSON.stringify(result.coverage, null, 2));
  await writeFile(path.join(outDir, 'suggestions.json'), JSON.stringify(result.suggestions, null, 2));

  const { coverage, missing, added } = result.coverage;
  console.log(`Coverage: ${(coverage * 100).toFixed(1)}% of source terms present`);
  if (missing.length) console.log(`  missing (${missing.length}): ${missing.slice(0, 40).join(', ')}`);
  if (added.length) console.log(`  added   (${added.length}): ${added.slice(0, 40).join(', ')}`);

  console.log(`\nSuggestions (${result.suggestions.length}):`);
  for (const s of result.suggestions) {
    console.log(`  [${s.category}] ${s.title}\n      ${s.reason}\n      "${s.find}" -> "${s.replace}"`);
  }
  console.log(`\nOutput: ${path.join(outDir, 'resume.pdf')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
