import React from 'react';
import notionSvg from '@assets/icons/services/notion-svgrepo-com.svg';

export default function NotionIcon({ size = 16, className = '', alt = '' }) {
  return (
    <img
      src={notionSvg}
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain dark:invert ${className}`.trim()}
      draggable={false}
      aria-hidden={alt ? undefined : true}
    />
  );
}
