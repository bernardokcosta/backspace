import { startDiagnosticCapture } from './utils/diagnostics';

const stop = startDiagnosticCapture();
if (import.meta.hot) import.meta.hot.dispose(stop);
