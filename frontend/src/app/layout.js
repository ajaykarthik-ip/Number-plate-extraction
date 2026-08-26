import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Shell from '@/components/layout/Shell'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] })

export const metadata = {
  title: 'AutoGate NX — Vehicle Access Control',
  description: 'Real-time number plate recognition and gate access monitoring',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
