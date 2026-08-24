import React from 'react';

export default function GoogleCalendarIcon({ size = 16, className = '' }) {
  return (
    <img
      src="icons/google-calendar.png"
      alt="Google Calendar"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
