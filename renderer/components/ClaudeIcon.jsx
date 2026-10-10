import React from 'react';
import claudeSvg from '@assets/icons/services/claude-icon.svg';

export default function ClaudeIcon({ size = 16, className = '' }) {
  return (
    <img
      src={claudeSvg}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain logo-mono ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
