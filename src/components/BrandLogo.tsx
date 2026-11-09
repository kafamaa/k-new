import { useState } from 'react'
import { useAppConfig } from '../lib/useAppConfig'

// The official brand. The mark is loaded from /assets/kulhivaru-mark.png and
// shown as-is (never redrawn or recoloured) wherever branding appears. Until
// the owner drops that file into public/assets/, the component falls back to
// the text wordmark only - no substitute mark is ever drawn.
export function BrandMark({ size = 30 }: { size?: number }) {
  const [stage, setStage] = useState<'loading' | 'ready' | 'missing'>('loading')
  if (stage === 'missing') return null
  return <img
    className="brand-mark"
    src="/assets/kulhivaru-mark.png"
    alt=""
    width={size}
    height={size}
    style={stage === 'loading' ? { visibility: 'hidden' } : undefined}
    onLoad={() => setStage('ready')}
    onError={() => setStage('missing')}
  />
}

// The logo is itself the link, so it is never wrapped in another link.
// A published brand (Customization Studio) replaces the name and, when set, the mark.
export function BrandLogo({ size = 30, word = true, wordClass = '', href = '#top', label, className = '' }: { size?: number; word?: boolean; wordClass?: string; href?: string; label?: string; className?: string }) {
  const brand = useAppConfig().config.brand
  const name = brand?.appName
  const plus = name?.endsWith('+')
  return <a className={`brand ${className}`.trim()} href={href} aria-label={label ?? `${name ?? 'Kulhivaru+'} home`}>
    {brand?.logoUrl ? <img className="brand-mark" src={brand.logoUrl} alt="" width={size} height={size} /> : <BrandMark size={size} />}
    {word ? <span className={`brand-word ${wordClass}`}>{name ? <>{(plus ? name.slice(0, -1) : name).toUpperCase()}{plus ? <b>+</b> : null}</> : <>KULHIVARU<b>+</b></>}</span> : null}
  </a>
}
