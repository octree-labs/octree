import {
  API_FREE_DAILY_CHECKS,
  API_FREE_DAILY_COMPILES,
  API_PRO_DAILY_CHECKS,
  API_PRO_DAILY_COMPILES,
} from '@/data/constants';
import { API_MAX_FILES, API_MAX_SOURCE_BYTES } from '@/lib/api/compile-request';
import { API_UPGRADE_URL } from '@/lib/api/quota';

/** OpenAPI 3.1 description of the public API, served at GET /api/v1/openapi.json. */

const errorSchema = {
  type: 'object',
  required: ['error', 'message'],
  properties: {
    error: {
      type: 'string',
      enum: [
        'invalid_request',
        'payload_too_large',
        'unauthorized',
        'rate_limited',
        'compile_unavailable',
        'compile_timeout',
        'service_unavailable',
        'internal_error',
      ],
    },
    message: { type: 'string' },
  },
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Octree Compile API',
    version: '1.1.0',
    description:
      `Compile LaTeX to PDF with one call. Authenticate with an API key from https://app.useoctree.com/settings#api-keys ` +
      `(Authorization: Bearer oct_live_...). Free accounts get ${API_FREE_DAILY_COMPILES} compiles a day, Pro ` +
      `${API_PRO_DAILY_COMPILES} (UTC days). The same key works with the MCP server at https://app.useoctree.com/api/mcp. ` +
      `The engine is pdfLaTeX unless the document needs XeLaTeX (fontspec, polyglossia, unicode-math, ...) or LuaLaTeX ` +
      `(luacode, \\directlua, ...), which are selected automatically. Shell escape is disabled. Text files only in v1. ` +
      `Every compile counts toward the daily compile quota. The MCP check_latex tool (errors only, no PDF) has its own ` +
      `daily allowance (${API_FREE_DAILY_CHECKS} free, ${API_PRO_DAILY_CHECKS} Pro). Sources are not stored or logged; ` +
      `PDFs returned as pdf_url are kept privately for 24 hours behind a signed link that expires after one hour.`,
  },
  servers: [{ url: 'https://app.useoctree.com' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/v1/compile': {
      post: {
        operationId: 'compile',
        summary: 'Compile LaTeX to PDF',
        description:
          'A LaTeX error is a successful call: HTTP 200 with ok=false and structured errors. 4xx/5xx mean the request, key, quota or service was the problem. ' +
          'Send response="pdf" (or Accept: application/pdf) to receive the raw PDF on success; failures are JSON either way. ' +
          'A JSON success carries the PDF twice: inline as pdf_base64 and as pdf_url, a signed link valid for one hour (null if it could not be created). ' +
          'Errors carry a short fix hint when one is known; quota shows what is left today.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CompileRequest' } } },
        },
        responses: {
          '200': {
            description: 'The compile ran (and counted toward the daily quota). ok=true with the PDF, or ok=false with LaTeX errors.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/CompileSuccess' },
                    { $ref: '#/components/schemas/CompileFailure' },
                  ],
                },
              },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '400': errorResponse('Invalid request (missing source, bad path, too many files, ...).'),
          '401': errorResponse('Missing, malformed, invalid or revoked API key.'),
          '413': errorResponse(`Source larger than ${API_MAX_SOURCE_BYTES} bytes (2 MB).`),
          '429': {
            description: 'Daily quota exceeded (quota_exceeded) or too many failed auth attempts (rate_limited).',
            content: {
              'application/json': {
                schema: {
                  oneOf: [{ $ref: '#/components/schemas/QuotaExceeded' }, { $ref: '#/components/schemas/Error' }],
                },
              },
            },
          },
          '503': errorResponse('The compile service is unavailable or busy (compile_unavailable). Retry later.'),
          '504': errorResponse('The compile did not finish in time (compile_timeout).'),
        },
      },
      get: {
        operationId: 'compileGetNotAllowed',
        summary: 'Not allowed: use POST',
        responses: { '405': errorResponse('Use POST.') },
      },
    },
    '/api/v1/me': {
      get: {
        operationId: 'me',
        summary: "The key's account, plan and today's usage",
        responses: {
          '200': {
            description: 'Usage summary',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } },
          },
          '401': errorResponse('Missing, invalid or revoked API key.'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'An Octree API key: oct_live_ followed by 32 characters.' },
    },
    schemas: {
      FileEntry: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', maxLength: 512, description: 'Relative path with forward slashes, e.g. sections/intro.tex' },
          content: { type: 'string', description: 'Text content. Binary files (images) are not supported in v1.' },
        },
      },
      CompileRequest: {
        type: 'object',
        description: 'Exactly one of `latex` or `files`. Text files only.',
        properties: {
          latex: { type: 'string', description: 'A complete single-file document; compiled as main.tex.' },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: API_MAX_FILES,
            items: { $ref: '#/components/schemas/FileEntry' },
          },
          main: {
            type: 'string',
            description:
              'With `files`: the root .tex file (must contain \\documentclass). Defaults to main.tex if present, else the first .tex file with \\documentclass.',
          },
          response: { type: 'string', enum: ['json', 'pdf'], default: 'json' },
        },
      },
      CompileError: {
        type: 'object',
        required: ['file', 'line', 'message', 'kind'],
        properties: {
          file: { type: ['string', 'null'] },
          line: { type: ['integer', 'null'] },
          message: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['missing_package', 'undefined_control_sequence', 'missing_dollar', 'missing_brace', 'latex_error'],
          },
          hint: {
            type: 'string',
            description: 'A one-sentence suggested fix for common errors, e.g. the \\usepackage that defines an undefined command.',
          },
        },
      },
      Engine: {
        type: ['string', 'null'],
        enum: ['pdflatex', 'xelatex', 'lualatex', null],
        description: 'The TeX engine that ran, when the compile service reports it.',
      },
      Quota: {
        type: 'object',
        required: ['counter', 'limit', 'used', 'remaining', 'resets_at'],
        description: "Today's counter after this call.",
        properties: {
          counter: { type: 'string', enum: ['compiles', 'checks'] },
          limit: { type: 'integer' },
          used: { type: 'integer' },
          remaining: { type: 'integer' },
          resets_at: { type: 'string', format: 'date-time' },
        },
      },
      CompileSuccess: {
        type: 'object',
        required: ['ok', 'pdf_base64', 'duration_ms', 'warnings', 'log_tail'],
        properties: {
          ok: { const: true },
          pdf_base64: { type: 'string', contentEncoding: 'base64', contentMediaType: 'application/pdf' },
          pdf_url: {
            type: ['string', 'null'],
            format: 'uri',
            description: 'Signed link to the PDF, valid until pdf_url_expires_at (one hour). Null if it could not be created.',
          },
          pdf_url_expires_at: { type: ['string', 'null'], format: 'date-time' },
          pages: { type: 'integer' },
          engine: { $ref: '#/components/schemas/Engine' },
          duration_ms: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
          log_tail: { type: 'string' },
          quota: { $ref: '#/components/schemas/Quota' },
        },
      },
      CompileFailure: {
        type: 'object',
        required: ['ok', 'errors', 'log_tail', 'duration_ms'],
        properties: {
          ok: { const: false },
          errors: { type: 'array', items: { $ref: '#/components/schemas/CompileError' } },
          warnings: { type: 'array', items: { type: 'string' } },
          log_tail: { type: 'string' },
          suggestion: { type: 'string' },
          engine: { $ref: '#/components/schemas/Engine' },
          duration_ms: { type: 'integer' },
          quota: { $ref: '#/components/schemas/Quota' },
        },
      },
      QuotaExceeded: {
        type: 'object',
        required: ['error', 'limit', 'used', 'resets_at', 'upgrade_url'],
        properties: {
          error: { const: 'quota_exceeded' },
          message: { type: 'string' },
          counter: { type: 'string', enum: ['compiles', 'checks'] },
          plan: { type: 'string', enum: ['free', 'pro'] },
          limit: { type: 'integer' },
          used: { type: 'integer' },
          resets_at: { type: 'string', format: 'date-time' },
          upgrade_url: { type: 'string', const: API_UPGRADE_URL },
        },
      },
      Me: {
        type: 'object',
        required: ['user_id', 'plan', 'daily_limit', 'used_today'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          plan: { type: 'string', enum: ['free', 'pro'] },
          daily_limit: { type: 'integer' },
          used_today: { type: 'integer' },
          remaining_today: { type: 'integer' },
          checks_daily_limit: { type: 'integer', description: 'MCP check_latex calls a day' },
          checks_used_today: { type: 'integer' },
          resets_at: { type: 'string', format: 'date-time' },
          upgrade_url: { type: 'string', description: 'Free plan only: where to upgrade.' },
        },
      },
      Error: errorSchema,
    },
  },
} as const;
