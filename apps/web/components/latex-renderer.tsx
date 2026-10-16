import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

export default function LatexRenderer({ latex }: { latex: string }) {
  return (
    <div className="max-w-full max-h-96 overflow-auto">
      <SyntaxHighlighter
        language="latex"
        style={oneDark}
        showLineNumbers
        wrapLines
        customStyle={{
          maxWidth: '100%',
          fontSize: '10px',
          margin: 0,
          maxHeight: 'none', // Allow content to determine height
        }}
      >
        {latex}
      </SyntaxHighlighter>
    </div>
  );
}
