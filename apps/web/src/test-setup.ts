import '@testing-library/jest-dom/vitest';

// jsdom does not implement Blob/File.arrayBuffer() (a real gap in its Web API
// coverage, not an app bug — the live browser E2E run for SEIP-UI-001 already
// exercised the real sha256Hex() in an actual browser successfully). Polyfill
// via the already-correct FileReader path so tests can exercise the same code.
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function arrayBuffer(this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
