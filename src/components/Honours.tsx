import { useEffect, useState } from 'react'
import { ShieldCheck, Trophy } from 'lucide-react'
import { getAchievementImages } from '../lib/publicData'
import { publicSupabase } from '../lib/supabase'
import { formatDay } from '../lib/display'

// Public trophies and milestones. Organizer-uploaded trophy images are read
// separately and only for items the public may already see; without an image
// (or before migration 029) the item keeps its icon.
export function Honours({ items }: { items: Record<string, unknown>[] }) {
  const [images, setImages] = useState<Map<string, string>>(new Map())
  const ids = items.map(item => String(item.id)).join(',')
  useEffect(() => {
    const client = publicSupabase
    if (!client || !ids) return
    let active = true
    void getAchievementImages(client, ids.split(',')).then(map => { if (active) setImages(map) })
    return () => { active = false }
  }, [ids])
  const isTrophy = (item: Record<string, unknown>) => String(item.milestone_type ?? '').startsWith('award_')
  return <ul className="ed-honours">{items.map(item => {
    const image = images.get(String(item.id))
    const trophy = isTrophy(item)
    return <li key={String(item.id)} className={`${trophy ? 'trophy' : ''}${image ? ' has-image' : ''}`}>
      {image ? <img className="ed-honour-image" src={image} alt={`${String(item.label)} trophy`} loading="lazy" /> : trophy ? <Trophy size={16} /> : <ShieldCheck size={16} />}
      <span><strong>{String(item.label)}</strong>{item.reached_at ? <small>{formatDay(item.reached_at)}</small> : null}<small>{item.is_manual ? 'Organizer-awarded' : trophy ? 'Award' : 'From confirmed matches'}</small></span>
    </li>
  })}</ul>
}
