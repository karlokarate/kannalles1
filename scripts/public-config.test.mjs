import { describe, expect, it } from 'vitest';
import {
  javascriptJsonLiteral,
  validateAppVersion,
  validatePublicGatewayUrl
} from './public-config.mjs';

describe('public build configuration', () => {
  it('accepts only safe semantic versions', () => {
    expect(validateAppVersion('2.2.4')).toBe('2.2.4');
    expect(() => validateAppVersion("2.2.4';alert(1)//")).toThrow();
  });

  it('canonicalizes empty, same-origin, HTTPS and loopback development bases', () => {
    expect(validatePublicGatewayUrl('')).toBe('');
    expect(validatePublicGatewayUrl('/')).toBe('/');
    expect(validatePublicGatewayUrl('/gateway/')).toBe('/gateway/');
    expect(validatePublicGatewayUrl('https://Gateway.Example/root')).toBe('https://gateway.example/root/');
    expect(validatePublicGatewayUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787/');
  });

  it('rejects cross-origin downgrade, userinfo, query, fragment and malformed bases', () => {
    for (const invalid of [
      '//evil.example', 'http://gateway.example', 'ftp://gateway.example',
      'https://user:secret@gateway.example', 'https://gateway.example/?tenant=x',
      'https://gateway.example/#fragment', '/gateway?tenant=x', '/gateway#fragment',
      'gateway', 'https://[broken', '/bad path'
    ]) {
      expect(() => validatePublicGatewayUrl(invalid), invalid).toThrow();
    }
  });

  it('emits hostile path characters only as inert JSON string data', () => {
    const canonical = validatePublicGatewayUrl("/x/';alert(1)/</script>");
    const literal = javascriptJsonLiteral(canonical);
    expect(literal).not.toContain('</script>');
    expect(JSON.parse(literal)).toBe(canonical);
  });
});
