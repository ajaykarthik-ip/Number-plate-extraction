'use client'

import { useMemo, useState } from 'react'
import {
  HiOutlineMagnifyingGlass,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineXMark,
} from 'react-icons/hi2'
import Plate from '@/components/common/Plate'
import Badge from '@/components/common/Badge'
import { useGate } from '@/context/GateContext'
import { tenants } from '@/data/registry'

const categories = ['All', 'Employee', 'Vendor', 'Cab', 'Facility', 'Visitor']

const categoryTone = {
  Employee: 'info',
  Vendor: 'warning',
  Cab: 'neutral',
  Facility: 'success',
  Visitor: 'danger',
}

export default function VehiclesPage() {
  const { registry, authorize, revoke } = useGate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    plate: '',
    owner: '',
    tenant: tenants[0],
    type: 'Car',
    category: 'Employee',
  })

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s/g, '')
    return registry.filter((v) => {
      const matchesQuery =
        !q ||
        v.plate.includes(q) ||
        v.owner.toUpperCase().includes(q) ||
        v.tenant.toUpperCase().includes(q)
      const matchesCategory = category === 'All' || v.category === category
      return matchesQuery && matchesCategory
    })
  }, [registry, query, category])

  const submit = (e) => {
    e.preventDefault()
    const plate = form.plate.toUpperCase().replace(/\s/g, '')
    if (!plate) return
    authorize(plate, { ...form, plate })
    setForm({ plate: '', owner: '', tenant: tenants[0], type: 'Car', category: 'Employee' })
    setFormOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Allowed Vehicles</h1>
          <p className="text-sm text-slate-500 mt-1">
            The park allow-list. A plate that is not here does not get the barrier.
          </p>
        </div>
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {formOpen ? <HiOutlineXMark className="w-4 h-4" /> : <HiOutlinePlus className="w-4 h-4" />}
          {formOpen ? 'Cancel' : 'Register vehicle'}
        </button>
      </div>

      {formOpen && (
        <form
          onSubmit={submit}
          className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 animate-slide-up"
        >
          <Field label="Number plate">
            <input
              value={form.plate}
              onChange={(e) => setForm({ ...form, plate: e.target.value })}
              placeholder="TN 09 BX 4521"
              className="input"
              required
            />
          </Field>
          <Field label="Driver / owner">
            <input
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              placeholder="Full name"
              className="input"
            />
          </Field>
          <Field label="Tenant">
            <select
              value={form.tenant}
              onChange={(e) => setForm({ ...form, tenant: e.target.value })}
              className="input"
            >
              {tenants.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle type">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="input"
            >
              {['Car', 'Bike', 'Truck', 'Bus'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Pass category">
            <div className="flex gap-2">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="input"
              >
                {categories.slice(1).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                type="submit"
                className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
              >
                Add
              </button>
            </div>
          </Field>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="relative flex-1 min-w-[220px]">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plate, driver or tenant"
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 transition-all"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  category === c
                    ? 'bg-primary-50 text-primary-700 border-primary-200'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 bg-slate-50/70">
                <th className="px-5 py-3 font-medium">Plate</th>
                <th className="px-5 py-3 font-medium">Driver</th>
                <th className="px-5 py-3 font-medium">Tenant</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Pass</th>
                <th className="px-5 py-3 font-medium">Valid till</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3">
                    <Plate value={v.plate} size="sm" />
                  </td>
                  <td className="px-5 py-3 text-slate-700">{v.owner}</td>
                  <td className="px-5 py-3 text-slate-500">{v.tenant}</td>
                  <td className="px-5 py-3">
                    <Badge variant={categoryTone[v.category] || 'neutral'}>{v.category}</Badge>
                    <span className="ml-2 text-xs text-slate-400">{v.type}</span>
                  </td>
                  <td className="px-5 py-3 plate text-xs text-slate-600">{v.pass}</td>
                  <td className="px-5 py-3 text-slate-500 tabular-nums">{v.validTill}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => revoke(v.plate)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
                    >
                      <HiOutlineTrash className="w-3.5 h-3.5" />
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                    No vehicles match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  )
}
