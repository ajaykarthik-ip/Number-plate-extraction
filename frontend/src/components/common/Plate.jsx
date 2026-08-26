import { formatPlate } from '@/data/registry'

/** The registration itself, drawn like a physical plate so it reads as one. */
export default function Plate({ value, size = 'md', tone = 'light' }) {
  const sizes = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-2xl px-4 py-2',
  }
  const tones = {
    light: 'bg-white border-slate-300 text-slate-800',
    dark: 'bg-slate-900 border-slate-600 text-white',
    granted: 'bg-green-50 border-green-300 text-green-800',
    denied: 'bg-red-50 border-red-300 text-red-800',
  }
  return (
    <span
      className={`plate inline-block rounded-md border-2 ${sizes[size]} ${tones[tone]} tabular-nums`}
    >
      {formatPlate(value)}
    </span>
  )
}
