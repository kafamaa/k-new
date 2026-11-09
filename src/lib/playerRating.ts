// Transparent, documented player rating formula.
// Method (visible to users in the Player Workspace and on the digital card):
//   A rating is computed ONLY from confirmed official statistics returned by the
//   get_player_official_statistics RPC (confirmed match result versions only).
//   1. Minimum data requirement: at least MIN_APPEARANCES confirmed appearances.
//      Below that, the rating is reported as insufficient data — never estimated.
//   2. Per-appearance rates: goalsPerApp = goals / appearances,
//      assistsPerApp = assists / appearances, yellowPerApp = yellow / appearances,
//      redPerApp = red / appearances.
//   3. Base score RATING_BASE + goalsPerApp * GOAL_WEIGHT + assistsPerApp * ASSIST_WEIGHT
//      - yellowPerApp * YELLOW_WEIGHT - redPerApp * RED_WEIGHT.
//   4. Clamp the result to [MIN_RATING, MAX_RATING] and round to 2 decimals.
//   5. Stars = round(rating / 2) clamped to 1..5 (display only).
// There is no existing rating formula in the product specification or codebase;
// this file defines the first documented method so the card never shows an
// undefined or arbitrary rating.

export const RATING_MIN_APPEARANCES = 3
export const RATING_BASE = 6
export const RATING_GOAL_WEIGHT = 1.5
export const RATING_ASSIST_WEIGHT = 1
export const RATING_YELLOW_WEIGHT = 0.5
export const RATING_RED_WEIGHT = 1.5
export const RATING_MIN = 1
export const RATING_MAX = 10

export const RATING_METHOD_SUMMARY = `Rating = ${RATING_BASE} + (goals/appearances)×${RATING_GOAL_WEIGHT} + (assists/appearances)×${RATING_ASSIST_WEIGHT} − (yellow cards/appearances)×${RATING_YELLOW_WEIGHT} − (red cards/appearances)×${RATING_RED_WEIGHT}, clamped to ${RATING_MIN}–${RATING_MAX}. Requires at least ${RATING_MIN_APPEARANCES} confirmed appearances; confirmed results only.`

export type RatingResult = { status: 'rated'; value: number; stars: number; appearances: number } | { status: 'insufficient_data'; appearances: number; reason: string }

export type OfficialTotals = { appearances: number; goals: number; assists: number; yellow: number; red: number }

export function totalOfficialStatistics(rows: Record<string, unknown>[]): OfficialTotals {
  return rows.reduce<OfficialTotals>((total, row) => ({
    appearances: total.appearances + Number(row.appearances ?? 0),
    goals: total.goals + Number(row.goals ?? 0),
    assists: total.assists + Number(row.assists ?? 0),
    yellow: total.yellow + Number(row.yellow_cards ?? 0),
    red: total.red + Number(row.red_cards ?? 0),
  }), { appearances: 0, goals: 0, assists: 0, yellow: 0, red: 0 })
}

export function computePlayerRating(totals: OfficialTotals): RatingResult {
  if (totals.appearances < RATING_MIN_APPEARANCES) {
    return { status: 'insufficient_data', appearances: totals.appearances, reason: `At least ${RATING_MIN_APPEARANCES} confirmed appearances are required. This profile has ${totals.appearances}.` }
  }
  const raw = RATING_BASE
    + (totals.goals / totals.appearances) * RATING_GOAL_WEIGHT
    + (totals.assists / totals.appearances) * RATING_ASSIST_WEIGHT
    - (totals.yellow / totals.appearances) * RATING_YELLOW_WEIGHT
    - (totals.red / totals.appearances) * RATING_RED_WEIGHT
  const value = Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, raw)) * 100) / 100
  const stars = Math.min(5, Math.max(1, Math.round(value / 2)))
  return { status: 'rated', value, stars, appearances: totals.appearances }
}

export function formatRating(result: RatingResult): string {
  return result.status === 'rated' ? `${result.value.toFixed(2)} / ${RATING_MAX}` : 'Insufficient data'
}
