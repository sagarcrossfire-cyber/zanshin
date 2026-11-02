// Blobs stores are site-wide and shared by every deploy context, so a
// preview must never write production's store: `<base>` for production,
// `<base>-<context>` otherwise, and `<base>-unknown` when the runtime does not
// say (so an unlabelled deploy can never pollute production's data).
// Used by diag (2.0 M1) and ranked (M2); sync (M3) uses it too.
export function scopedStoreName(base: string, deployContext: string | undefined): string {
  const context = (deployContext ?? '').trim().toLowerCase();
  if (context === 'production') return base;
  const safe = context.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base}-${safe === '' ? 'unknown' : safe}`;
}
