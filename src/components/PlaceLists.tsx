import { useEffect, useState } from 'react'
import { placeLists } from '../lib/appConfig'

// Suggestion lists for island, atoll and venue fields (Platform admin → Configuration).
// Inputs opt in with list="kv-islands", "kv-atolls" or "kv-venues"; any name can still be typed.
export function PlaceLists() {
  const [lists, setLists] = useState(placeLists)
  useEffect(() => {
    const update = () => setLists(placeLists())
    update()
    window.addEventListener('kulhivaru:config', update)
    return () => window.removeEventListener('kulhivaru:config', update)
  }, [])
  return <>{(['atolls', 'islands', 'venues'] as const).map(key => <datalist key={key} id={`kv-${key}`}>{lists[key].map(value => <option key={value} value={value} />)}</datalist>)}</>
}
