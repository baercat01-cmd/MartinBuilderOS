/** Max receipt size the app accepts (200 MiB). */
export const MAX_MAINTENANCE_RECEIPT_BYTES = 200 * 1024 * 1024;

/** Above this size, upload to storage and pass a URL for OCR (edge function body limit). */
export const RECEIPT_SCAN_URL_MIN_BYTES = 8 * 1024 * 1024;

export const MAX_MAINTENANCE_RECEIPT_LABEL = '200MB';

export function formatReceiptSizeLimitMessage(fileName: string): string {
  return `${fileName} must be less than ${MAX_MAINTENANCE_RECEIPT_LABEL}`;
}
