import React from 'react';
import geminiSvg from '@assets/icons/services/Google_Gemini_icon_2025.svg';

export default function GeminiIcon({ size = 16, className = '' }) {
  return (
    <img
      src={geminiSvg}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
