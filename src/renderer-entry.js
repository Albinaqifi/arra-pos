import { startRenderer } from './desktop-status.js';

// esbuild includes this module in the same local bundle. Delay evaluating its
// React classes until startup has checked the vendor runtime and desktop mode.
startRenderer(() => import('./App.js'));
