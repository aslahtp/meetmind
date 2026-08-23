import React from 'react';

export default function GoogleCalendarIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Calendar body */}
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Top hooks */}
      <path d="M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Header line */}
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" />
      {/* Calendar dots */}
      <circle cx="8" cy="13" r="1" fill="currentColor" />
      <circle cx="12" cy="13" r="1" fill="currentColor" />
      <circle cx="16" cy="13" r="1" fill="currentColor" />
      <circle cx="8" cy="17" r="1" fill="currentColor" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}
