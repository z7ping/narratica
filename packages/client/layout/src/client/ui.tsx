import { useId } from 'react'
import narraticaWordmarkUrl from './assets/narratica-wordmark.svg'

export function NarraticaWordmark({ className }: { readonly className?: string }) {
  return <img className={className} src={narraticaWordmarkUrl} alt="Narratica" draggable={false} />
}

export function NarraticaMark({ size = 32, className }: { readonly size?: number; readonly className?: string }) {
  const id = useId().replaceAll(':', '')
  const nStroke = `narratica-n-${id}`
  const penStroke = `narratica-pen-${id}`
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 128 128" role="img" aria-label="Narratica">
      <defs>
        <linearGradient id={nStroke} x1="18" y1="50" x2="100" y2="106" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0D1B2A" /><stop offset=".74" stopColor="#0D1B2A" /><stop offset="1" stopColor="#F5A623" />
        </linearGradient>
        <linearGradient id={penStroke} x1="98" y1="40" x2="69" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0D1B2A" /><stop offset=".72" stopColor="#0D1B2A" /><stop offset="1" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <path fill={`url(#${nStroke})`} d="M98.4 85.44 97.99 84.82 96.87 85.13 86.76 93.4 80.23 97.38 75.33 99.11 71.86 99.42 69.82 99.11 67.47 97.99 65.84 96.26 64.51 92.78 64.41 87.58 66.55 76.15 66.35 72.88 65.53 71.35 64.82 70.74 63.49 70.33 61.04 70.63 56.96 72.88 54.51 74.82 51.55 77.78 46.65 83.9 55.22 69.1 57.98 63.29 59.1 59.51 59.1 55.83 58.18 53.59 57.16 52.47 55.73 51.65 52.57 51.34 49 52.36 42.97 55.94 38.48 59.71 33.48 64.82 28.07 71.45 23.17 78.6 19.09 86.05 17.76 89.52 17.56 91.66 18.58 93.19 19.7 93.3 20.21 92.99 22.86 87.48 26.23 81.96 31.23 75.02 34.91 70.53 38.99 66.04 44.5 60.73 48.79 57.57 51.85 56.24 52.67 56.24 53.28 56.75 53.38 58.9 52.16 63.18 50.73 66.76 47.46 73.59 43.99 79.92 34.81 94.62 30.62 102.18 29.6 105.24 29.7 106.16 30.62 107.28 32.46 107.59 34.19 106.46 41.44 95.44 49.3 84.93 55.12 78.7 57.88 76.35 59.61 75.33 60.33 75.33 60.63 75.64 60.84 76.76 60.33 80.03 58.18 88.7 57.77 92.68 57.98 96.46 59 99.73 60.94 102.58 62.88 104.11 65.33 105.24 68.8 105.85 73.9 105.34 78.29 103.91 82.88 101.56 88.29 97.79 93.3 93.19 97.58 87.78Z" />
      <path fill={`url(#${penStroke})`} d="M96.66 40.01 95.03 39.5 93.4 39.81 90.95 41.95 85.44 49.4 80.64 57.37 76.15 66.25 72.17 76.35 78.29 64.61 73.59 74.51 70.53 81.96 68.59 87.89 68.39 89.82 68.7 90.23 69.31 90.23 70.23 89.52 75.13 83.29 75.84 82.99 87.99 67.27 94.93 56.85 99.11 48.59 100.13 44.91 99.83 42.97 98.81 42.56 94.21 48.69 96.05 45.63 97.48 42.46 97.58 41.14Z" />
      <path fill="#F5A623" d="M100.64 16.64 98.91 22.76 97.58 24.91 95.03 26.64 89.42 28.17 94.42 29.7 97.17 31.23 98.6 33.17 100.44 39.2 102.28 33.38 103.81 31.23 106.67 29.7 111.36 28.48 106.05 26.74 104.83 26.13 103.3 24.7 101.87 21.54Z" />
    </svg>
  )
}
