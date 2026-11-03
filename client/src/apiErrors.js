export function formatApiError(error, fallback = 'The request could not be completed.') {
  const status = Number(error?.status);
  const message = typeof error?.message === 'string' ? error.message.trim() : '';

  if (status === 400) return message || 'Check the submitted values and try again.';
  if (status === 404) {
    return message
      ? `The requested record or resource is unavailable. ${message}`
      : 'The requested record or resource is unavailable. Refresh the page and try again.';
  }
  if (status === 409) {
    return (
      message ||
      'The workbook changed since this data was loaded. Refresh and review before trying again.'
    );
  }
  if (status === 413) return message || 'The uploaded file is too large.';
  if (status >= 500)
    return `The server could not complete the request (HTTP ${status}). Try again.`;
  if (!Number.isFinite(status) && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'The API server could not be reached. Check the connection and try again.';
  }
  return message || fallback;
}

export function acquireRequestLock(lockRef) {
  if (lockRef.current) return false;
  lockRef.current = true;
  return true;
}

export function releaseRequestLock(lockRef) {
  lockRef.current = false;
}
