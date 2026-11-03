import assert from 'node:assert/strict';
import { acquireRequestLock, formatApiError, releaseRequestLock } from '../src/apiErrors.js';

assert.equal(
  formatApiError({ status: 400, message: 'priority must be an integer.' }),
  'priority must be an integer.'
);
assert.match(
  formatApiError({ status: 404, message: 'Release R-404 does not exist.' }),
  /requested record or resource is unavailable/i
);
assert.equal(
  formatApiError({ status: 409, message: 'The workbook changed.' }),
  'The workbook changed.'
);
assert.match(
  formatApiError({ status: 503, message: 'Internal stack trace' }),
  /server could not complete.*503/i
);
assert.match(formatApiError(new TypeError('Failed to fetch')), /API server could not be reached/i);

const lock = { current: false };
assert.equal(acquireRequestLock(lock), true, 'the first submit should acquire the lock');
assert.equal(
  acquireRequestLock(lock),
  false,
  'a duplicate submit should be rejected while pending'
);
releaseRequestLock(lock);
assert.equal(acquireRequestLock(lock), true, 'the lock should be available after completion');
releaseRequestLock(lock);

console.log('Form support verification passed.');
