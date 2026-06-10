import { supabase } from '@/lib/supabase';
import type { Job } from '@/types';

type DefaultJobSpec = {
  name: string;
  client_name: string;
  address: string;
};

export const DEFAULT_NCC_JOB: DefaultJobSpec = {
  name: 'NCC',
  client_name: 'Sheldon Weaver',
  address: 'N/A',
};

export const DEFAULT_TRAINING_JOB: DefaultJobSpec = {
  name: 'Training',
  client_name: 'Internal',
  address: 'N/A',
};

export const DEFAULT_TIME_ENTRY_JOBS: DefaultJobSpec[] = [
  DEFAULT_NCC_JOB,
  DEFAULT_TRAINING_JOB,
];

async function ensureDefaultJob(
  spec: DefaultJobSpec,
  userId?: string
): Promise<Job | null> {
  try {
    const { data: matches, error: fetchError } = await supabase
      .from('jobs')
      .select('*')
      .eq('name', spec.name)
      .order('created_at', { ascending: true });

    if (fetchError) throw fetchError;

    const existing = matches?.[0];

    if (existing) {
      const needsUpdate =
        existing.client_name !== spec.client_name ||
        existing.status !== 'active' ||
        existing.is_internal === true;

      if (!needsUpdate) {
        return existing as Job;
      }

      const { data: updated, error: updateError } = await supabase
        .from('jobs')
        .update({
          client_name: spec.client_name,
          status: 'active',
          is_internal: false,
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError) throw updateError;
      return updated as Job;
    }

    const { data: created, error: createError } = await supabase
      .from('jobs')
      .insert({
        name: spec.name,
        client_name: spec.client_name,
        address: spec.address,
        documents: [],
        components: [],
        status: 'active',
        is_internal: false,
        created_by: userId || null,
      })
      .select('*')
      .single();

    if (createError) throw createError;
    return created as Job;
  } catch (error) {
    console.error(`Error ensuring default job "${spec.name}":`, error);
    return null;
  }
}

/** Ensures default time-entry jobs exist and are active. */
export async function ensureDefaultTimeEntryJobs(userId?: string): Promise<Job[]> {
  const jobs = await Promise.all(
    DEFAULT_TIME_ENTRY_JOBS.map((spec) => ensureDefaultJob(spec, userId))
  );
  return jobs.filter((job): job is Job => job != null);
}

/** @deprecated Use ensureDefaultTimeEntryJobs */
export async function ensureDefaultNccJob(userId?: string): Promise<Job | null> {
  const jobs = await ensureDefaultTimeEntryJobs(userId);
  return jobs.find((job) => job.name === DEFAULT_NCC_JOB.name) ?? null;
}

const DEFAULT_JOB_NAME_KEYS = new Set(
  DEFAULT_TIME_ENTRY_JOBS.map((job) => job.name.trim().toLowerCase())
);

/** Keep one row per default job name (NCC, Training) in picker lists. */
export function dedupeDefaultJobNames(jobs: Job[]): Job[] {
  const seenDefaultNames = new Set<string>();
  const result: Job[] = [];

  for (const job of jobs) {
    const nameKey = job.name.trim().toLowerCase();
    if (DEFAULT_JOB_NAME_KEYS.has(nameKey)) {
      if (seenDefaultNames.has(nameKey)) continue;
      seenDefaultNames.add(nameKey);
    }
    result.push(job);
  }

  return result;
}

/** Put default jobs first (NCC, then Training) and dedupe by id and default name. */
export function prioritizeDefaultJobs<T extends Job>(jobs: T[], defaultJobs: Job[]): T[] {
  let result: Job[] = jobs;
  for (let i = defaultJobs.length - 1; i >= 0; i--) {
    const job = defaultJobs[i];
    const nameKey = job.name.trim().toLowerCase();
    result = result.filter(
      (entry) =>
        entry.id !== job.id && entry.name.trim().toLowerCase() !== nameKey
    );
    result = [job, ...result];
  }
  return dedupeDefaultJobNames(result) as T[];
}

/** @deprecated Use prioritizeDefaultJobs */
export function prioritizeDefaultNccJob(jobs: Job[], nccJob: Job | null): Job[] {
  return nccJob ? prioritizeDefaultJobs(jobs, [nccJob]) : jobs;
}
