import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { VEHICLE_IMAGE_MAX_BYTES } from '@/lib/fleetUploadLimits';
import { ensureVehicleImagesStorage, isStoragePolicyError } from '@/lib/maintenanceLogSchema';

export type VehicleImageUploadResult = {
  publicUrl: string;
  bucket: 'vehicle-images' | 'job-files';
  path: string;
};

function vehicleImageContentType(file: File, fileExt: string): string {
  return file.type || `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
}

async function tryUpload(
  client: SupabaseClient,
  bucket: 'vehicle-images' | 'job-files',
  path: string,
  file: File,
  contentType: string,
) {
  return client.storage.from(bucket).upload(path, file, {
    contentType,
    cacheControl: '3600',
    upsert: true,
  });
}

/** Upload equipment photo — prefers vehicle-images, falls back to job-files on OnSpace. */
export async function uploadFleetVehicleImage(
  vehicleId: string,
  file: File,
  client: SupabaseClient = supabase,
): Promise<VehicleImageUploadResult> {
  if (file.size > VEHICLE_IMAGE_MAX_BYTES) {
    throw new Error(`Image must be ${Math.round(VEHICLE_IMAGE_MAX_BYTES / (1024 * 1024))} MB or smaller`);
  }

  await ensureVehicleImagesStorage(client);

  const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `${vehicleId}-${Date.now()}.${fileExt}`;
  const contentType = vehicleImageContentType(file, fileExt);

  let { error } = await tryUpload(client, 'vehicle-images', fileName, file, contentType);

  if (error && isStoragePolicyError(error)) {
    await ensureVehicleImagesStorage(client);
    ({ error } = await tryUpload(client, 'vehicle-images', fileName, file, contentType));
  }

  if (!error) {
    const { data } = client.storage.from('vehicle-images').getPublicUrl(fileName);
    return { publicUrl: data.publicUrl, bucket: 'vehicle-images', path: fileName };
  }

  if (!isStoragePolicyError(error)) {
    throw error;
  }

  const fleetPath = `fleet-vehicle-images/${fileName}`;
  const fallback = await tryUpload(client, 'job-files', fleetPath, file, contentType);
  if (fallback.error) {
    throw fallback.error;
  }

  const { data } = client.storage.from('job-files').getPublicUrl(fleetPath);
  return { publicUrl: data.publicUrl, bucket: 'job-files', path: fleetPath };
}
