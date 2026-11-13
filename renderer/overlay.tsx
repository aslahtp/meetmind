import React from 'react';
import { createRoot } from 'react-dom/client';
import MeetingOverlay from './components/overlay/MeetingOverlay';
import './styles/globals.css';
import './styles/overlay.css';

// Entry point for the floating meeting overlay window (electron/overlay/overlay-window.ts).
createRoot(document.getElementById('root')!).render(<MeetingOverlay />);
