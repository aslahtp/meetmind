import React from 'react';
import assemblyAiSvg from '@assets/icons/services/assemblyai-color.svg';

export default function AssemblyAiIcon({ size = 16, className = '' }) {
  return (
    <img
      src={assemblyAiSvg}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
