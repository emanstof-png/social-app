/**
 * The "Liked N of M recent visits" hint next to Settings' "Find more
 * communities" button (spec 09 item 6, decision 8). A plain count, no model
 * call. Pure: no Supabase, no fetch, no process.env
 * (docs/CONVENTIONS.md#pure-core-server-edge).
 */

export type CommunityHint = {
  liked: number;
  total: number;
};

/**
 * `likedFlags` is the newest-five `preference_log.liked` values for one
 * activity's genre-typed rows. Fewer than two says nothing yet -- the
 * caller shows nothing rather than a hint built on a single data point.
 */
export function communityHint(likedFlags: boolean[]): CommunityHint | null {
  if (likedFlags.length < 2) return null;
  return {
    liked: likedFlags.filter(Boolean).length,
    total: likedFlags.length,
  };
}
