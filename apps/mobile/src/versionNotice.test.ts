import { describe, expect, it } from 'vitest';

import { releaseLine, versionMismatchNotice } from './versionNotice.ts';

describe('releaseLine', () => {
  it('gives major.minor for release versions', () => {
    expect(releaseLine('1.2.3')).toBe('1.2');
    expect(releaseLine('1.2.3-rc.1')).toBe('1.2');
  });

  it('gives null for dev, unknown and missing versions', () => {
    expect(releaseLine('dev.142+1cfdacb')).toBeNull();
    expect(releaseLine('unknown')).toBeNull();
    expect(releaseLine(null)).toBeNull();
    expect(releaseLine(undefined)).toBeNull();
  });
});

describe('versionMismatchNotice', () => {
  it('is quiet on the same release line', () => {
    expect(versionMismatchNotice('1.2.3', '1.2.3')).toBeNull();
    expect(versionMismatchNotice('1.2.3', '1.2.9')).toBeNull();
    expect(versionMismatchNotice('1.2.3-rc.1', '1.2.3')).toBeNull();
    expect(versionMismatchNotice('1.2.3', '1.2.4-rc.2')).toBeNull();
  });

  it('warns with both versions when major.minor differ', () => {
    const minor = versionMismatchNotice('1.2.3', '1.3.0');
    expect(minor?.app).toContain('1.2.3');
    expect(minor?.server).toContain('1.3.0');
    const major = versionMismatchNotice('2.0.0-rc.1', '1.9.9');
    expect(major?.app).toContain('2.0.0-rc.1');
    expect(major?.server).toContain('1.9.9');
  });

  it('never warns for dev or unknown builds on either side', () => {
    expect(versionMismatchNotice('dev.142+1cfdacb', '1.2.3')).toBeNull();
    expect(versionMismatchNotice('1.2.3', 'dev.142+1cfdacb')).toBeNull();
    expect(versionMismatchNotice('unknown', '1.2.3')).toBeNull();
    expect(versionMismatchNotice('1.2.3', 'unknown')).toBeNull();
    expect(versionMismatchNotice('1.2.3', null)).toBeNull();
    expect(versionMismatchNotice('1.2.3', undefined)).toBeNull();
  });
});
