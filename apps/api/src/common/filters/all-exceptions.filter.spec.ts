import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

/** 最小 ArgumentsHost 替身：只提供 filter 真正用到的 getResponse/getRequest。 */
function hostOf(captured: Captured): Parameters<AllExceptionsFilter['catch']>[1] {
  const reply = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    header(name: string, value: string) {
      captured.headers[name] = value;
      return this;
    },
    send(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };
  const request = { id: 'req-1', method: 'POST', url: '/api/admin/auth/login' };
  return {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }),
  } as unknown as Parameters<AllExceptionsFilter['catch']>[1];
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('把限流异常翻译成可读文案，并带上 Retry-After', () => {
    const captured: Captured = { headers: {} };
    filter.catch(new ThrottlerException(), hostOf(captured));
    assert.equal(captured.status, HttpStatus.TOO_MANY_REQUESTS);
    assert.equal(captured.body?.code, 'RATE_LIMITED');
    assert.equal(captured.body?.message, '操作过于频繁，请稍后再试');
    assert.ok(!String(captured.body?.message).includes('ThrottlerException'));
    assert.equal(captured.headers['Retry-After'], '60');
  });

  it('普通 HTTP 异常保留业务文案与状态码', () => {
    const captured: Captured = { headers: {} };
    filter.catch(
      new HttpException({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' }, HttpStatus.UNAUTHORIZED),
      hostOf(captured),
    );
    assert.equal(captured.status, 401);
    assert.equal(captured.body?.message, '邮箱或密码不正确');
    assert.equal(captured.body?.requestId, 'req-1');
  });

  it('校验失败数组不直接暴露给前端，改为参数校验失败 + details', () => {
    const captured: Captured = { headers: {} };
    filter.catch(
      new HttpException({ message: ['password must be longer than 8 characters'] }, HttpStatus.BAD_REQUEST),
      hostOf(captured),
    );
    assert.equal(captured.body?.code, 'VALIDATION_FAILED');
    assert.equal(captured.body?.message, '参数校验失败');
  });
});
