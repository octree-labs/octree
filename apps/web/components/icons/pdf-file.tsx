// Lucide-style file outline with a large solid "PDF" tag; inherits text color.
export function PdfFile({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M15 2H7a2 2 0 0 0-2 2v4" />
      <path d="M5 21a2 2 0 0 0 2 1h11a2 2 0 0 0 2-2V7l-5-5" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <rect x="0" y="9" width="21" height="11" rx="2" fill="currentColor" stroke="none" />
      <text
        x="10.5"
        y="17.6"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="800"
        letterSpacing="-0.5"
        fontFamily="Helvetica, Arial, sans-serif"
        fill="white"
        stroke="none"
      >
        PDF
      </text>
    </svg>
  );
}
