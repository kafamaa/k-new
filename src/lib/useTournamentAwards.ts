import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTournamentAwards, type TournamentAward } from './competitionRecords'

// Awards for one tournament, shared by the Settings awards panel and the
// completion check so both read the same rows.
export function useTournamentAwards(client: SupabaseClient, tournamentId: string) {
  const [awards, setAwards] = useState<TournamentAward[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const reload = useCallback(() => {
    void loadTournamentAwards(client, tournamentId).then(result => { setAwards(result.data); setError(result.error ?? ''); setLoaded(true) })
  }, [client, tournamentId])
  useEffect(() => { reload() }, [reload])
  return { awards, error, loaded, reload }
}
