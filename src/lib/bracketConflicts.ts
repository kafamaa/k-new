import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expectedQualifiers, loadCompetitionStructure, type CardPoints, type CompetitionStage, type StageGroup, type StageMatch } from './advancement'
import { progressionConflicts, type ProgressionConflict } from './tournamentEngine'

// Later-round matches that still hold a team a corrected result knocked out
// (owner, 2026-11-03). Listing only: nothing is replaced here.
export type BracketStructure = { stages: CompetitionStage[]; groups: StageGroup[]; matches: StageMatch[]; cards?: CardPoints[] }

export function bracketConflictList(structure: BracketStructure): Array<ProgressionConflict & { stageName: string }> {
  return structure.stages.filter(stage => typeof stage.rules.previous_stage_id === 'string' && stage.rules.third_place_match !== true).flatMap(stage => {
    const source = structure.stages.find(item => item.id === stage.rules.previous_stage_id)
    if (!source) return []
    const expected = expectedQualifiers(source, structure.matches, structure.groups, structure.cards)
    if (!expected) return []
    return progressionConflicts(structure.matches.filter(match => match.stageId === stage.id), expected).map(conflict => ({ ...conflict, stageName: stage.name }))
  })
}

// Used by the Finish step: unresolved conflicts block the archive. Null while loading.
export function useBracketConflicts(client: SupabaseClient, tournamentId: string, reloadKey: number): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    void loadCompetitionStructure(client, tournamentId).then(result => { if (active) setCount(result.error ? null : bracketConflictList(result).length) })
    return () => { active = false }
  }, [client, tournamentId, reloadKey])
  return count
}
