import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deye Solar Dashboard',
  description: 'Real-time solar inverter monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
