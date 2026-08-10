import React from 'react';
import notionIcon from '@assets/icons/icons8-notion-100.png';

export default function NotionIcon({ size = 16, className = '', alt = '' }) {
  return (
    <img
      src={notionIcon}
      alt={alt}
      width={size}
      height={size}
      style={{ filter: 'invert(1)' }}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
      draggable={false}
      aria-hidden={alt ? undefined : true}
    />
  );
}
