import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HostScheduler',
  description: 'HostScheduler control panel',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
