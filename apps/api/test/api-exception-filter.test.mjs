import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js';

function invokeFilter(exception) {
  let statusCode;
  let body;
  const response = { status(value) { statusCode = value; return this; }, json(value) { body = value; return this; } };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ requestId: 'request-1', path: '/api/v1/public/orders', method: 'POST' }) }) };
  new ApiExceptionFilter().catch(exception, host);
  return { statusCode, body };
}

test('price-change errors preserve only allowlisted, bounded public pricing details', () => {
  const result = invokeFilter(new ConflictException({
    code: 'PRICE_CHANGED', message: 'قیمت تغییر کرده است.',
    changes: [{ listingId: '123e4567-e89b-12d3-a456-426614174000', title: 'کالای عمومی', expectedPriceRial: '1000', currentPriceRial: '1200', expectedTaxRateBasisPoints: 900, currentTaxRateBasisPoints: 1000, phone: '09121234567' }],
    expectedTotalRial: '1090', currentTotalRial: '1320', address: 'نشانی مشتری',
  }));
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'PRICE_CHANGED');
  assert.equal(result.body.changes[0].currentPriceRial, '1200');
  assert.equal(result.body.currentTotalRial, '1320');
  assert.equal(JSON.stringify(result.body).includes('09121234567'), false);
  assert.equal(JSON.stringify(result.body).includes('نشانی مشتری'), false);
});

test('other conflict errors never pass through arbitrary exception details', () => {
  const result = invokeFilter(new ConflictException({ code: 'ORDER_CONFLICT', message: 'تعارض.', phone: '09121234567', address: 'نشانی مشتری' }));
  assert.equal(result.body.code, 'ORDER_CONFLICT');
  assert.equal('phone' in result.body, false);
  assert.equal('address' in result.body, false);
});
