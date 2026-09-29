import React from 'react';

// Simple monochrome "G" mark used for the Groq provider.
export default function GroqIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`.trim()}
      aria-hidden="true"
    >
      <path d="M18.5 7.5A8 8 0 1 0 20 12h-7" />
    </svg>
  );
}
