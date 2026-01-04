# AI LaTeX Editor

An AI-powered collaborative LaTeX editor with real-time PDF compilation and intelligent editing suggestions.

## Prerequisites

Before running this project locally, ensure you have the following installed:

- **Node.js** (v20 or higher)
- **npm** or **yarn** or **pnpm** or **bun**
- **Docker Desktop** (optional, for faster local LaTeX PDF compilation - falls back to remote service if not available)
- **Supabase CLI** (optional, for local database development)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/octree-labs/octree.git
cd octree
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 3. Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# Supabase Configuration (Required)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe Configuration (Required for billing features)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# AI Provider Key (Required for AI editing features)
OPENAI_API_KEY=your_openai_api_key

# Environment (Optional)
ENVIRONMENT=dev  # Set to 'prod' for production
NODE_ENV=development
```

#### Getting Your Keys:

- **Supabase**: Sign up at [supabase.com](https://supabase.com), create a project, and get your URL and anon key from Project Settings > API
- **Stripe**: Get API keys from [stripe.com/dashboard](https://dashboard.stripe.com/apikeys)
- **OpenAI**: Get API key from [platform.openai.com](https://platform.openai.com/api-keys) - The app uses GPT-5 with smart model selection (GPT-5 mini for small tasks, GPT-5 for large/complex files)

### 4. Database Setup

This project uses Supabase for authentication and data storage. You need to:

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
2. **Run migrations** (located in `supabase/migrations/`):
   ```bash
   # If using Supabase CLI locally
   supabase db push
   
   # Or manually run the SQL files in the Supabase SQL Editor:
   # - 001_add_user_usage_table.sql
   # - 002_add_monthly_limits.sql
   # - 003_fix_ambiguous_column_reference.sql
   ```

### 5. Docker Setup (for PDF Compilation) - Optional

The app can compile LaTeX to PDF locally using Docker in development mode:

1. **Install Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop) (optional)
2. **Start Docker Desktop** (if installed)
3. **Pull the TeX Live image** (optional, will auto-pull on first use):
   ```bash
   docker pull texlive/texlive
   ```

> **Note**: 
> - If Docker is not installed or not running, the app automatically falls back to the remote compilation service
> - In production (`ENVIRONMENT=prod`), the app always uses the remote compilation service
> - Docker is recommended for faster local compilation, but **not required**

### 6. Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Project Structure

```
ai-latex-editor/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── projects/          # Project management
│   └── ...
├── components/            # React components
│   ├── editor/           # Editor-specific components
│   ├── ui/               # Reusable UI components
│   └── ...
├── hooks/                # Custom React hooks
├── lib/                  # Utility functions and configs
├── actions/              # Server actions
├── supabase/             # Database migrations
└── types/                # TypeScript type definitions
```

## Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Key Features

- 🤖 **AI-Powered Editing** - Intelligent LaTeX suggestions with smart GPT-5 model selection (mini for speed, full for complex tasks)
- 📝 **Monaco Editor** - Advanced code editing with syntax highlighting
- 📄 **Real-time PDF Compilation** - Instant preview of your LaTeX documents
- 👥 **Authentication** - Secure user auth via Supabase
- 💳 **Subscription Management** - Stripe integration for billing
- 📊 **Usage Tracking** - Monitor API usage and limits

## Troubleshooting

### Docker Issues
- **Docker is optional** - the app will automatically use the remote service if Docker is unavailable
- If you want to use Docker locally:
  - Ensure Docker Desktop is running
  - Check Docker has sufficient resources allocated (Settings > Resources)
  - Verify the `tmp/` directory can be created in the project root
- If compilation fails, check the browser console for error details

### Database Connection
- Verify Supabase credentials in `.env.local`
- Check if migrations have been run
- Ensure your IP is allowed in Supabase project settings

### API Keys
- Ensure all required API keys are set in `.env.local`
- Check API key permissions and quotas
- Verify keys are not expired

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Stripe Documentation](https://stripe.com/docs)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Make sure to set all environment variables in your Vercel project settings.

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
