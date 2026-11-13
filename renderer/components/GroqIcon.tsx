import React from 'react';
import groqPng from '@assets/icons/services/groq-icon.svg';

export default function GroqIcon({ size = 16, className = '' }: { size?: any; className?: any }) {
  return (
    <img
      src={groqPng}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain logo-mono ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
