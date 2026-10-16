// Two-star AI spark cluster; inherits text color — callers set e.g. text-primary
export function Sparkles({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M9.5 7.5 Q9.5 14.5 16.5 14.5 Q9.5 14.5 9.5 21.5 Q9.5 14.5 2.5 14.5 Q9.5 14.5 9.5 7.5 Z" />
      <path d="M18 2 Q18 6 22 6 Q18 6 18 10 Q18 6 14 6 Q18 6 18 2 Z" />
    </svg>
  );
}
