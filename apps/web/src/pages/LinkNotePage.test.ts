import { describe, expect, it } from 'vitest';
import { isWebAddress } from './LinkNotePage';

describe('isWebAddress (FR-015)', () => {
  it('accepts http and https', () => {
    expect(isWebAddress('https://youtu.be/abc')).toBe(true);
    expect(isWebAddress(' http://drive.google.com/x ')).toBe(true);
  });
  it('refuses script, data and file addresses, and junk', () => {
    for (const v of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'youtu.be/abc', '']) {
      expect(isWebAddress(v)).toBe(false);
    }
  });
});
