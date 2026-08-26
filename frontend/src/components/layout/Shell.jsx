'use client'

import { useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { GateProvider } from '@/context/GateContext'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

export default function Shell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <GateProvider>
      <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex-1 flex flex-col min-w-0">
          <Navbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <div className="animate-fade-in">{children}</div>
          </main>
        </div>
      </div>
      <Toaster position="top-right" toastOptions={{ style: { fontSize: '13px' } }} />
    </GateProvider>
  )
}
