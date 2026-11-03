// 2.0 M2 — loader for the rank ladder pack (ranks.json). Kept out of
// ./index.ts so the ranked function bundles only this small pack, not the
// moves data. Validated once with Zod; the pure helpers live in
// src/domain/ranked/ranks.ts.
import { z } from 'zod';
import type { RankPack } from '../../domain/ranked/ranks';
import ranksJson from './ranks.json';

const rankPackSchema = z.object({
  version: z.number().int().positive(),
  source: z.string().min(1),
  altEncodings: z.object({
    rangeFrom: z.number().int(),
    rangeTo: z.number().int(),
    rangeMinus: z.number().int(),
    values: z.record(z.string(), z.number().int()),
  }),
  ladder: z.array(z.object({
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional(),
  })).min(1),
  bands: z.array(z.object({
    id: z.string().min(1),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    label: z.string().min(1),
    share: z.string().min(1),
    stages: z.tuple([z.number().int().min(0).max(9), z.number().int().min(0).max(9)]),
    focus: z.string().min(1),
  })).min(1),
});

let cached: RankPack | undefined;

export function loadRankPack(): RankPack {
  cached ??= rankPackSchema.parse(ranksJson);
  return cached;
}
