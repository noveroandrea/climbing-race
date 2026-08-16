import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the build has no credentials — solo play still works, online does not. */
export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.warn(
    '[grip&race] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
    'Single player works; the leaderboard and multiplayer are disabled.',
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } },
});
