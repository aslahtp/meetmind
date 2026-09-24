import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import './styles/globals.css';

// Entry point. Mounting lives here, not in app.jsx, so app.jsx exports only a component and
// React Fast Refresh can hot-swap it during `pnpm run dev` instead of reloading the page.
createRoot(document.getElementById('root')).render(<App />);
