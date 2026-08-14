import React from 'react';
import sarvamSvg from '@assets/icons/services/sarvam-light.svg';

export default function SarvamIcon({ size = 16, className = '' }) {
  return (
    <img
      src={sarvamSvg}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
