/** Max vehicle/equipment photo size (80 MB). Must match storage.buckets.file_size_limit for vehicle-images. */
export const VEHICLE_IMAGE_MAX_BYTES = 80 * 1024 * 1024;

export function formatFleetUploadLimit(bytes: number): string {
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}
