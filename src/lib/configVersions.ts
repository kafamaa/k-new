import type { SupabaseClient } from '@supabase/supabase-js'
import { adminProblem, needsMigration } from './superAdmin'
import type { ConfigKind, ConfigVersion } from './appConfig'

const FIELDS = 'id,version,status,config,summary,created_by,reviewed_by,review_note,published_at,rollback_of,created_at,updated_at'

// Versions of one configuration kind. Before migration 035 there is only appearance.
export async function loadVersions(client: SupabaseClient, kind: ConfigKind): Promise<{ data: ConfigVersion[]; error: string | null }> {
  const result = await client.from('app_configuration_versions').select(`${FIELDS},kind`).eq('kind', kind).order('version', { ascending: false }).limit(30)
  if (!result.error) return { data: (result.data ?? []) as ConfigVersion[], error: null }
  if (kind === 'appearance' && /kind/.test(result.error.message)) {
    const legacy = await client.from('app_configuration_versions').select(FIELDS).order('version', { ascending: false }).limit(30)
    if (!legacy.error) return { data: (legacy.data ?? []) as ConfigVersion[], error: null }
  }
  return { data: [], error: needsMigration(result.error.message) ? `${kind === 'platform' ? 'Platform configuration' : 'Customization'} needs migrations 202611010034 and 202611010035 to be applied.` : adminProblem(result.error.message) }
}

export async function saveDraft(client: SupabaseClient, kind: ConfigKind, id: string | null, config: object, summary: string): Promise<{ id: string | null; error: string | null }> {
  let result = await client.rpc('admin_save_config_draft', { p_id: id, p_config: config, p_summary: summary, p_kind: kind })
  // Before 035 the function has no kind argument (appearance only).
  if (result.error && kind === 'appearance' && needsMigration(result.error.message)) result = await client.rpc('admin_save_config_draft', { p_id: id, p_config: config, p_summary: summary })
  return result.error ? { id: null, error: adminProblem(result.error.message) } : { id: String(result.data), error: null }
}
