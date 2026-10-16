
import { Button } from '@/components/ui/button';

export const SUGGESTIONS = [
    {
        title: 'Research paper on ML',
        description: 'machine learning fundamentals',
        prompt: 'Write a research paper on the fundamentals of machine learning, covering supervised learning, unsupervised learning, and neural networks.',
    },
    {
        title: 'Technical report',
        description: 'system architecture overview',
        prompt: 'Write a technical report documenting a microservices architecture, including system design, API specifications, and deployment considerations.',
    },
    {
        title: 'Literature review',
        description: 'climate change impacts',
        prompt: 'Write a literature review examining recent research on climate change impacts on global biodiversity and ecosystem services.',
    },
    {
        title: 'Conference paper',
        description: 'distributed systems',
        prompt: 'Write a conference paper on consensus algorithms in distributed systems, comparing Raft, Paxos, and Byzantine fault-tolerant approaches.',
    },
];

interface WelcomeStateProps {
    onSelectSuggestion: (prompt: string) => void;
}

export function WelcomeState({ onSelectSuggestion }: WelcomeStateProps) {
    return (
        <div className="flex h-full flex-col items-center justify-center px-4">
            <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold text-foreground">Generate Document</h1>
                <p className="mt-2 text-muted-foreground">
                    Describe what you want to create and get a complete LaTeX document
                </p>
            </div>
            <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                    <Button
                        key={suggestion.prompt}
                        variant="outline"
                        onClick={() => onSelectSuggestion(suggestion.prompt)}
                        className="h-auto flex-col items-start gap-1 p-4 text-left"
                    >
                        <span className="font-medium">{suggestion.title}</span>
                        <span className="text-sm text-muted-foreground">{suggestion.description}</span>
                    </Button>
                ))}
            </div>
        </div>
    );
}
