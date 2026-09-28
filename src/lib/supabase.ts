import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const MISSING_ENV_MSG =
  'Missing Supabase config. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file and restart the dev server.';

const LOCALHOST_ERROR_MSG =
  'ERROR: Supabase URL is set to localhost in production. Please set VITE_SUPABASE_URL to your actual Supabase project URL (e.g., https://yourproject.supabase.co) in your deployment environment variables.';

// Validate configuration on module load
if (supabaseUrl) {
  const isLocalhost = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1');
  const isProduction = import.meta.env.PROD;
  
  if (isLocalhost && isProduction) {
    console.error(
      `\n⚠️  CRITICAL CONFIGURATION ERROR ⚠️\n\n` +
      `VITE_SUPABASE_URL is set to: ${supabaseUrl}\n` +
      `This will not work in production!\n\n` +
      `Expected format: https://<project-ref>.supabase.co\n` +
      `or https://<project-id>.backend.onspace.ai\n\n` +
      `Please check your deployment environment variables.\n`
    );
    throw new Error(LOCALHOST_ERROR_MSG);
  }
  
  // Log configuration in development for debugging
  if (!isProduction) {
    console.log('Supabase URL:', supabaseUrl);
  }
}

function getClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(MISSING_ENV_MSG);
  }
  return clientInstance!;
}

let clientInstance: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'fieldtrack-auth',
          storage: window.localStorage,
        },
      })
    : null;

// Time tracking moved to Arca Field on 2026-09-28. Every write to time_entries is refused here
// (reads still work so old history stays viewable). All time writes in this app go through
// supabase.from('time_entries'), so this one guard covers clock-in/out, quick entry, shop clock,
// manual entry, edits and deletes.
export const TIME_RETIRED_MESSAGE =
  'Time entry has moved to Arca Field (field.arcasystems.app). Martin Builder no longer records time — please clock in on Arca Field.';

let retiredNoticeShown = false;
function showRetiredNotice() {
  if (retiredNoticeShown || typeof window === 'undefined') return;
  retiredNoticeShown = true;
  window.alert(TIME_RETIRED_MESSAGE);
  setTimeout(() => {
    retiredNoticeShown = false;
  }, 5000);
}

/** A chainable, awaitable stand-in for a blocked write: any filter call returns itself; awaiting it yields an error. */
function blockedWrite(): any {
  const result = {
    data: null,
    error: { message: TIME_RETIRED_MESSAGE, code: 'TIME_RETIRED', details: '', hint: '' },
    count: null,
    status: 403,
    statusText: 'Time entry moved to Arca Field',
  };
  const chain: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          showRetiredNotice();
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        if (prop === 'catch' || prop === 'finally') {
          return (fn: (v: unknown) => unknown) => (Promise.resolve(result) as any)[prop](fn);
        }
        return () => chain;
      },
    },
  );
  return chain;
}

const TIME_WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

function guardTimeEntries(builder: any): any {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && TIME_WRITE_METHODS.has(prop)) return () => blockedWrite();
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Expose client; throw only when first used so the app can mount and show an error UI
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getClient() as any;
    if (prop === 'from') {
      return (table: string) => {
        const builder = client.from(table);
        return table === 'time_entries' ? guardTimeEntries(builder) : builder;
      };
    }
    return client[prop];
  },
});
