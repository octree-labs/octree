import type { AtsCheck, AtsCheckStatus } from '@/types/resume';

// Deterministic checks on the text an ATS gets out of the PDF (the output of
// extractPdfText): can it find the contact details, the standard sections and
// the dates, and is the text free of characters that break keyword search.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// 9+ digits with the usual separators, e.g. +1 (555) 123-4567, 0300 1234567.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g;
const PROFILE_URL = /\b(?:linkedin\.com\/in\/|github\.com\/)[\w-]+/i;
const PROFILE_WORD = /\b(?:linkedin|github)\b/i;

// Contact details further down than this are often missed by parsers that
// read the header block only.
const HEADER_LINES = 12;

const SECTION_ALIASES = {
  experience: /\b(?:experience|employment|work history|career history)\b/,
  education: /\b(?:education|academic background|academics)\b/,
  skills: /\b(?:skills|competencies|technologies|tech stack|toolbox)\b/,
  projects: /\bprojects\b/,
};
// A heading is a short line; longer lines that mention "experience" are content.
const MAX_HEADING_WORDS = 4;

const MONTH_YEAR = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+'?\d{2,4}\b/gi;
const NUMERIC_DATE = /\b\d{1,2}\/(?:\d{2}|\d{4})\b/g;
const YEAR = /\b(?:19|20)\d{2}\b/g;

const LIGATURES = /[ﬀ-ﬆ]/g;
// Icon fonts (FontAwesome phone / mail glyphs) and unmapped glyphs.
const BROKEN_GLYPHS = /[-�]|\(cid:\d+\)/g;

const MIN_WORDS = 250;
const MAX_WORDS = 1000;
const MAX_PAGES = 2;

function check(
  id: string,
  category: AtsCheck['category'],
  status: AtsCheckStatus,
  title: string,
  detail: string
): AtsCheck {
  return { id, category, status, title, detail };
}

function headingLines(lines: string[]): string[] {
  return lines
    .filter((line) => line.split(/\s+/).length <= MAX_HEADING_WORDS)
    .map((line) => line.toLowerCase().replace(/[^a-z&\s]/g, ' ').replace(/\s+/g, ' ').trim());
}

function contactChecks(lines: string[], text: string): AtsCheck[] {
  const header = lines.slice(0, HEADER_LINES).join('\n');
  const checks: AtsCheck[] = [];

  if (EMAIL.test(header)) {
    checks.push(check('contact-email', 'contact', 'pass', 'Email address', 'Found at the top of the resume.'));
  } else if (EMAIL.test(text)) {
    checks.push(check('contact-email', 'contact', 'warn', 'Email address', 'Found, but not in the header. Some systems only read contact details from the top.'));
  } else {
    checks.push(check('contact-email', 'contact', 'fail', 'Email address', 'No email address could be read from the PDF.'));
  }

  const hasPhone = (header.match(PHONE) ?? []).some((m) => m.replace(/\D/g, '').length >= 9);
  checks.push(
    hasPhone
      ? check('contact-phone', 'contact', 'pass', 'Phone number', 'Found at the top of the resume.')
      : check('contact-phone', 'contact', 'warn', 'Phone number', 'No phone number in the header. Recruiters often filter on it.')
  );

  if (PROFILE_URL.test(text)) {
    checks.push(check('contact-profile', 'contact', 'pass', 'Profile link', 'A LinkedIn or GitHub URL is written out in full.'));
  } else if (PROFILE_WORD.test(text)) {
    checks.push(check('contact-profile', 'contact', 'warn', 'Profile link', 'The link shows as a label (e.g. "LinkedIn"), so a text-only parser never sees the URL. Write the address out, e.g. linkedin.com/in/yourname.'));
  } else {
    checks.push(check('contact-profile', 'contact', 'warn', 'Profile link', 'No LinkedIn or GitHub profile. Most ATS profiles have a field for it.'));
  }

  return checks;
}

function sectionChecks(lines: string[]): AtsCheck[] {
  const headings = headingLines(lines);
  const has = (key: keyof typeof SECTION_ALIASES) => headings.some((h) => SECTION_ALIASES[key].test(h));

  const experience = has('experience')
    ? check('section-experience', 'sections', 'pass', 'Experience section', 'Found a standard experience heading.')
    : has('projects')
      ? check('section-experience', 'sections', 'warn', 'Experience section', 'No experience heading, only projects. If you have work experience, give it its own "Experience" section.')
      : check('section-experience', 'sections', 'fail', 'Experience section', 'No heading an ATS would recognise as experience. Use "Experience" or "Work Experience".');

  const education = has('education')
    ? check('section-education', 'sections', 'pass', 'Education section', 'Found a standard education heading.')
    : check('section-education', 'sections', 'warn', 'Education section', 'No "Education" heading was found.');

  const skills = has('skills')
    ? check('section-skills', 'sections', 'pass', 'Skills section', 'Found a standard skills heading.')
    : check('section-skills', 'sections', 'warn', 'Skills section', 'No "Skills" heading. A skills list is where most keyword matching happens.');

  return [experience, education, skills];
}

function dateCheck(text: string): AtsCheck {
  const monthYear = text.match(MONTH_YEAR)?.length ?? 0;
  const numeric = text.match(NUMERIC_DATE)?.length ?? 0;
  const years = text.match(YEAR)?.length ?? 0;

  if (years === 0 && numeric === 0) {
    return check('parsing-dates', 'parsing', 'warn', 'Dates', 'No dates were found. ATSs use them to work out your years of experience.');
  }
  if (monthYear > 0 && numeric > 0) {
    return check('parsing-dates', 'parsing', 'warn', 'Dates', 'Dates mix formats (e.g. "Jan 2022" and "01/2022"). Pick one so every range parses the same way.');
  }
  return check('parsing-dates', 'parsing', 'pass', 'Dates', 'Dates are in a consistent, readable format.');
}

function characterCheck(text: string): AtsCheck {
  const broken = text.match(BROKEN_GLYPHS) ?? [];
  if (broken.length > 0) {
    return check('parsing-characters', 'parsing', 'fail', 'Unreadable characters', `${broken.length} character${broken.length === 1 ? '' : 's'} came out as unreadable glyphs, usually icons from an icon font. Replace icons with plain text labels.`);
  }
  const ligatures = text.match(LIGATURES) ?? [];
  if (ligatures.length > 0) {
    return check('parsing-characters', 'parsing', 'warn', 'Ligatures', `${ligatures.length} ligature${ligatures.length === 1 ? '' : 's'} (e.g. "ﬁ" in "ﬁnance") were extracted as single characters, so a search for the word can miss it.`);
  }
  return check('parsing-characters', 'parsing', 'pass', 'Readable text', 'Every character extracts as plain text.');
}

function lengthChecks(words: number, totalPages: number): AtsCheck[] {
  const textCheck =
    words < 50
      ? check('parsing-text', 'parsing', 'fail', 'Extractable text', 'Almost no text could be read from the PDF. Parts of it may be images.')
      : check('parsing-text', 'parsing', 'pass', 'Extractable text', 'The text can be selected and read.');

  const pages =
    totalPages > MAX_PAGES
      ? check('length-pages', 'length', 'warn', 'Page count', `${totalPages} pages. Keep it to one or two.`)
      : check('length-pages', 'length', 'pass', 'Page count', `${totalPages} page${totalPages === 1 ? '' : 's'}.`);

  const wordCount =
    words < MIN_WORDS
      ? check('length-words', 'length', 'warn', 'Length', `About ${words} words. Resumes under ${MIN_WORDS} words usually leave out detail that keyword matching relies on.`)
      : words > MAX_WORDS
        ? check('length-words', 'length', 'warn', 'Length', `About ${words} words. Over ${MAX_WORDS} words and recruiters skim; cut the weakest bullets.`)
        : check('length-words', 'length', 'pass', 'Length', `About ${words} words.`);

  return [textCheck, pages, wordCount];
}

export function runParseChecks(text: string, totalPages: number): AtsCheck[] {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean).length;
  return [
    ...contactChecks(lines, text),
    ...sectionChecks(lines),
    dateCheck(text),
    characterCheck(text),
    ...lengthChecks(words, totalPages),
  ];
}

const STATUS_POINTS: Record<AtsCheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

/** 0-100: a pass is worth 1, a warning half, a failure nothing. */
export function scoreChecks(checks: AtsCheck[]): number {
  if (checks.length === 0) return 100;
  const points = checks.reduce((sum, c) => sum + STATUS_POINTS[c.status], 0);
  return Math.round((points / checks.length) * 100);
}
