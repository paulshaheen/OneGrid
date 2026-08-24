import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Build stamp — open the browser console to confirm you're on the latest bundle.
// If you don't see this line (or see an older stamp), your browser is serving a cached
// build: hard-refresh (Ctrl+Shift+R) or open a private window.
const BUILD_STAMP = '2026-08-18T10:40Z-govnav';
// eslint-disable-next-line no-console
console.log('%cOneGrid UI build ' + BUILD_STAMP, 'color:#3f96ff;font-weight:bold');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
