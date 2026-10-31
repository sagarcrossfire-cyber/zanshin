// §6.3/§6.4 — Profile repository: the single 'me' profile row.
import { db } from '../db';
import { profileSchema, type Profile } from '../schemas';

export const profileRepo = {
  /** Returns the profile, or undefined before onboarding completes. */
  async get(): Promise<Profile | undefined> {
    return db.profile.get('me');
  },
  /** Validates and upserts the profile. */
  async put(profile: Profile): Promise<Profile> {
    const parsed = profileSchema.parse(profile);
    await db.profile.put(parsed);
    return parsed;
  },
  /** Returns all profile rows (at most one). */
  async all(): Promise<Profile[]> {
    return db.profile.toArray();
  },
  /** Removes the profile row. */
  async remove(): Promise<void> {
    await db.profile.delete('me');
  },
};
