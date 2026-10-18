// Subscription and usage limits
export const FREE_DAILY_EDIT_LIMIT = 5;
export const PRO_MONTHLY_EDIT_LIMIT = 500;
export const PRO_SUBSCRIPTION_PRICE = 4.99;

// Display copy for the two live Stripe prices. Keep in sync with lib/stripe-config.ts:
// `proAnnual` is the $9.99/month price and `pro` is the $4.99/week price
// (`createCheckoutSession({ annual: true })` buys the monthly plan).
export const PRO_PLANS = {
  monthly: {
    amount: 9.99,
    price: '$9.99',
    interval: 'month',
    // What the monthly plan works out to per week, next to the weekly plan's $4.99.
    weeklyEquivalent: '$2.49',
    billingNote: 'Billed monthly at $9.99/month — save 50%',
  },
  weekly: {
    amount: 4.99,
    price: '$4.99',
    interval: 'week',
    billingNote: 'Billed weekly at $4.99/week',
  },
} as const;

export const DEFAULT_LATEX_CONTENT = (title: string) => `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
This is the main document for your project: ${title}.

\\section{Getting Started}
You can start writing your LaTeX content here.

\\end{document}`;

export const DEFAULT_LATEX_CONTENT_FROM_FILENAME = (fileName: string) => {
  const cleanTitle = fileName.replace(/\.\w+$/, '');
  return `% ${fileName}
% Created on ${new Date().toISOString()}

\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{${cleanTitle}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Your content here.

\\end{document}`;
};

export const NON_LATEX_FILE_CONTENT = (fileName: string, projectTitle: string, fileSize: number | null, fileType: string | null) => `// File: ${fileName}
// Project: ${projectTitle}
// Size: ${fileSize || 'Unknown'} bytes
// Type: ${fileType || 'Unknown'}

// File content would be loaded here in a real implementation.
// This file type (${fileType || 'unknown'}) is not currently supported for editing.`;
