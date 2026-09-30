import { createRoot } from 'react-dom/client';
import '@fontsource/inter/600.css';
import { initBackend } from '../ipc';
import { RegionOverlay } from './RegionOverlay';

document.documentElement.style.background = 'transparent';
document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden';
void initBackend().then(() => createRoot(document.getElementById('root')!).render(<RegionOverlay />));
