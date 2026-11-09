// Artwork for the home page. The hero and the default tournament covers are
// photos from the owner's design (public/assets/covers). Emblems and
// silhouettes are drawn as inline SVG. Every piece is decorative (aria-hidden)
// and never stands in for a real record.

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/covers/${file}`
export const HERO_PHOTO = asset('hero-photo.jpg')
export const HERO_WIDE = asset('hero-top.jpg')
export const PAGE_BANNER = asset('page-banner.jpg')

// Default cover for a tournament card without an uploaded cover image: the
// owner's design photos (night court, beach volleyball, island football).
const COVER_BY_SPORT: Record<string, string> = { football: 'island-football', volleyball: 'beach-volleyball', handball: 'handball-court', basketball: 'basketball-court', basketball_3x3: 'basketball-court' }
export function CoverScene({ sport }: { sport: string }) {
  const file = COVER_BY_SPORT[sport.toLowerCase()] ?? 'night-court'
  return <img className="lp-cover-art" src={asset(`${file}.jpg`)} alt="" loading="lazy" decoding="async" width={323} height={104} />
}

// Team logos keep their original outline and transparency, without an added badge.
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}
export function TeamLogo({ name, logoUrl, size = 44 }: { name: string; logoUrl?: string | null; size?: number }) {
  return <span className="lp-team-logo" style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * .28)) }} aria-hidden="true">
    {logoUrl ? <img src={logoUrl} alt="" loading="lazy" decoding="async" /> : <span>{initials(name)}</span>}
  </span>
}

const SHIELD = 'M20 2 L37 7.5 V21 C37 32.5 29.6 40.4 20 44 C10.4 40.4 3 32.5 3 21 V7.5 Z'

// Tournament emblem shown when no tournament logo was uploaded.
export function TournamentEmblem() {
  return <svg className="lp-emblem" viewBox="0 0 40 46" aria-hidden="true" focusable="false">
    <defs><linearGradient id="lp-emblem-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1fc3d6" /><stop offset="1" stopColor="#0a4f6b" /></linearGradient></defs>
    <path d={SHIELD} fill="url(#lp-emblem-g)" stroke="#0b2540" strokeOpacity=".15" />
    <path d="M14 12 h12 v6 a6 6 0 0 1 -12 0z M14 14 h-3 a3 3 0 0 0 3 5 M26 14 h3 a3 3 0 0 1 -3 5 M20 24 v4 M16 30 h8" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 35 q5 -3 10 0 t10 0" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" fill="none" />
  </svg>
}

// Player without a photo: a neutral silhouette, never a made-up face.
export function PersonAvatar() {
  return <svg className="lp-avatar" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
    <circle cx="22" cy="22" r="22" fill="#d8e0e4" />
    <circle cx="22" cy="17" r="7.5" fill="#7d878d" />
    <path d="M7.5 39 c2.4 -8.6 8.2 -12.6 14.5 -12.6 s12.1 4 14.5 12.6 a22 22 0 0 1 -29 0z" fill="#7d878d" />
  </svg>
}

// Small sport marks for the "Find your sport" tiles.
export function SportGlyph({ sport }: { sport: string }) {
  if (sport === 'basketball_3x3') return <span className="lp-glyph-text" aria-hidden="true">3×3</span>
  const common = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false }
  switch (sport) {
    case 'futsal': return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="1.5" /><path d="M12 5v14" /><circle cx="12" cy="12" r="2.6" /><path d="M2 9h3v6H2M22 9h-3v6h3" /></svg>
    case 'volleyball': return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M12 12a8 8 0 0 0-7.6-5.4M12 12a8 8 0 0 1 8.2 3.6M12 12a8 8 0 0 0-1 9.8M12 2a10 10 0 0 1 2.6 9.6M5 19.5A10 10 0 0 1 12 12M21.6 9.4A10 10 0 0 1 12 12" /></svg>
    case 'handball': return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M12 2c-2.6 3-2.6 7 0 10s2.6 7 0 10M2.4 10.5c3.2 1.6 6.4 1.8 9.6 1.5s6.4.1 9.6 1.5" /></svg>
    case 'basketball': return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2v20M5 4.9c3.6 3.4 3.6 10.8 0 14.2M19 4.9c-3.6 3.4-3.6 10.8 0 14.2" /></svg>
    default: return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="m12 7.2 4.3 3.1-1.6 5h-5.4l-1.6-5z" /><path d="M12 2v5.2M16.3 10.3l5.2-1.6M14.7 15.3l3.2 4.3M9.3 15.3l-3.2 4.3M7.7 10.3 2.5 8.7" /></svg>
  }
}
