import React from 'react';
import claudePng from '@assets/icons/icons8-claude-96.png';

export default function ClaudeIcon({ size = 16, className = '' }) {
  return (
    <img
      src={claudePng}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
