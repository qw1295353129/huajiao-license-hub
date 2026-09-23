import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { domainFromHeaders, domainMatches, normalizeDomain } from './domain';

describe('域名归一化', () => {
  it('去掉协议、端口、路径、www 与大小写差异', () => {
    assert.equal(normalizeDomain('HTTPS://WWW.Example.com:8080/a/b?x=1').domain, 'example.com');
    assert.equal(normalizeDomain('example.com').domain, 'example.com');
    assert.equal(normalizeDomain('http://example.com/').domain, 'example.com');
    assert.equal(normalizeDomain('  Example.COM.  ').domain, 'example.com');
    assert.equal(normalizeDomain('www.example.com').domain, 'example.com');
  });

  it('IDN 转为 punycode', () => {
    const result = normalizeDomain('例え.jp');
    assert.equal(result.valid, true);
    assert.ok(result.domain.startsWith('xn--'), result.domain);
  });

  it('保留子域（只去 www）', () => {
    assert.equal(normalizeDomain('shop.example.com').domain, 'shop.example.com');
    assert.equal(normalizeDomain('WWW.shop.example.com').domain, 'shop.example.com');
  });

  it('识别本地与内网地址', () => {
    assert.equal(normalizeDomain('localhost:3000').domain, 'localhost');
    assert.equal(normalizeDomain('localhost').isLocal, true);
    assert.equal(normalizeDomain('192.168.1.10').isLocal, true);
    assert.equal(normalizeDomain('example.com').isLocal, false);
  });

  it('拒绝非法输入', () => {
    assert.equal(normalizeDomain('').valid, false);
    assert.equal(normalizeDomain('   ').valid, false);
    assert.equal(normalizeDomain('http://').valid, false);
    assert.equal(normalizeDomain('not a domain').valid, false);
    assert.equal(normalizeDomain('example').valid, false, '单标签不能当域名');
    assert.equal(normalizeDomain('a..b.com').valid, false);
  });
});

describe('域名匹配', () => {
  it('精确匹配', () => {
    assert.equal(domainMatches('example.com', 'example.com'), true);
    assert.equal(domainMatches('other.com', 'example.com'), false);
  });

  it('允许子域时覆盖 *.example.com，但不覆盖 notexample.com', () => {
    assert.equal(domainMatches('a.example.com', 'example.com', true), true);
    assert.equal(domainMatches('deep.a.example.com', 'example.com', true), true);
    assert.equal(domainMatches('notexample.com', 'example.com', true), false);
    assert.equal(domainMatches('a.example.com', 'example.com', false), false);
  });

  it('空值不匹配', () => {
    assert.equal(domainMatches('', 'example.com'), false);
    assert.equal(domainMatches('example.com', ''), false);
  });
});

describe('domainFromHeaders', () => {
  it('优先 headers.host，忽略可伪造的 x-forwarded-host', () => {
    const result = domainFromHeaders({ host: 'app.example.com', 'x-forwarded-host': 'evil.example' });
    assert.equal(result.domain, 'app.example.com');
  });

  it('host 缺失时才回退到 x-forwarded-host', () => {
    const result = domainFromHeaders({ 'x-forwarded-host': 'cdn.example.com' });
    assert.equal(result.domain, 'cdn.example.com');
  });
});
