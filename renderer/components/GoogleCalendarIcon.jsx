import React from 'react';

// Monochrome Google Calendar mark (tile with a folded corner and "31"), drawn in
// currentColor so it follows the surrounding text colour in both themes. The colour PNG
// can't be used here: the mono filter flattened it into a solid square.
export default function GoogleCalendarIcon({ size = 16, className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`.trim()}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5V16l-5 5H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Z" />
      <path d="M16 21v-3.5a1.5 1.5 0 0 1 1.5-1.5H21" />
      <text
        x="11.3"
        y="15.6"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        letterSpacing="-0.4"
        fill="currentColor"
        stroke="none"
        fontFamily="inherit"
      >
        31
      </text>
    </svg>
  );
}
