import React from 'react';
import googleCloudSvg from '@assets/icons/services/icons8-google-cloud.svg';

export default function GoogleCloudIcon({ size = 16, className = '' }) {
  return (
    <img
      src={googleCloudSvg}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden="true"
    />
  );
}
