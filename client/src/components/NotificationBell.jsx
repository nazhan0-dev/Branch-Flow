import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Boxes, Check, Clock, FileText, Truck, X } from 'lucide-react'
import api from '../api/client'
import { useSocket } from '../lib/socket'
import { date, isToday, time } from '../lib/format'
import { Drawer } from './ui'

// ประเภทแจ้งเตือน → หมวด, ไอคอน, สี
const KIND = {
    request_submitted: ['stock', FileText, 'neutral'],
    auto_draft: ['stock', FileText, 'neutral'],
    hq_proposal: ['stock', Boxes, 'neutral'],
    request_approved: ['stock', Check, 'brand'],
    request_rejected: ['urgent', AlertTriangle, 'danger'],
    count_needed: ['urgent', AlertTriangle, 'warn'],
    receive_issue: ['urgent', AlertTriangle, 'warn'],
    stock_out: ['urgent', AlertTriangle, 'danger'],
    trip_assigned: ['transport', Truck, 'neutral'],
    trip_accepted: ['transport', Truck, 'neutral'],
    trip_started: ['transport', Truck, 'brand'],
    truck_arrived: ['transport', Clock, 'warn'],
    stop_received: ['transport', Check, 'brand'],
    trip_completed: ['transport', Check, 'brand'],
}
const TONE = {
    neutral: 'bg-[#eef0ed] text-ink',
    brand: 'bg-brand-soft text-brand-ink',
    warn: 'bg-warn-soft text-warn-ink',
    danger: 'bg-danger-soft text-danger-ink',
}
const kindOf = (n) => {
    const k = KIND[n.type] || ['stock', Bell, 'neutral']
    // ข้อความที่มีคำว่า "ด่วน" นับเป็นหมวดด่วนด้วย
    return n.message.includes('ด่วน') && k[0] !== 'urgent' ? ['urgent', k[1], 'danger'] : k
}

export default function NotificationBell({ variant = 'rail' }) {
    const [data, setData] = useState({ unread: 0, items: [] })
    const [open, setOpen] = useState(false)
    const [tab, setTab] = useState('all')
    const [toast, setToast] = useState(null)
    const navigate = useNavigate()

    const load = useCallback(() => api.get('/notifications').then((r) => setData(r.data)).catch(() => {}), [])
    useEffect(() => {
        load()
    }, [load])

    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), 5000)
        return () => clearTimeout(t)
    }, [toast])

    useSocket(
        'notification',
        useCallback((n) => {
            load()
            setToast(n)
        }, [load])
    )

    const items = useMemo(() => data.items.map((n) => ({ ...n, kind: kindOf(n) })), [data.items])
    const counts = useMemo(() => ({ urgent: items.filter((n) => n.kind[0] === 'urgent').length }), [items])
    const shown = tab === 'all' ? items : items.filter((n) => n.kind[0] === tab)

    // จัดกลุ่ม วันนี้ / เมื่อวาน / วันที่
    const groups = useMemo(() => {
        const yesterday = date(Date.now() - 864e5)
        const out = []
        for (const n of shown) {
            const label = isToday(n.createdAt) ? 'วันนี้' : date(n.createdAt) === yesterday ? 'เมื่อวาน' : date(n.createdAt)
            if (!out.length || out.at(-1).label !== label) out.push({ label, items: [] })
            out.at(-1).items.push(n)
        }
        return out
    }, [shown])

    const readAll = async () => {
        await api.post('/notifications/read-all').catch(() => {})
        load()
    }
    const go = (link) => {
        setOpen(false)
        setToast(null)
        if (link) navigate(link)
    }

    const TABS = [
        ['all', `ทั้งหมด ${items.length}`],
        ['urgent', `ด่วน ${counts.urgent}`],
        ['stock', 'สต็อก'],
        ['transport', 'ขนส่ง'],
    ]

    return (
        <>
            <button
                aria-label="การแจ้งเตือน"
                title="การแจ้งเตือน"
                onClick={() => setOpen(true)}
                className={`relative grid size-10 shrink-0 place-items-center rounded-xl bg-white ${variant === 'rail' ? 'border border-line' : ''}`}
            >
                <Bell size={18} />
                {data.unread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">{data.unread > 99 ? '99+' : data.unread}</span>
                )}
            </button>

            <Drawer open={open} onClose={() => setOpen(false)}>
                <div className="flex items-center justify-between">
                    <h2 className="text-[26px] font-semibold">การแจ้งเตือน</h2>
                    <div className="flex items-center gap-2">
                        {data.unread > 0 && <button onClick={readAll} className="px-2 text-[13px] font-semibold">อ่านทั้งหมด</button>}
                        <button aria-label="ปิด" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-xl border border-line"><X size={18} /></button>
                    </div>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                    {TABS.map(([k, label]) => (
                        <button key={k} onClick={() => setTab(k)} className={`h-[34px] shrink-0 rounded-xl px-3.5 text-[13px] ${tab === k ? 'bg-ink font-semibold text-white' : 'border border-line'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                <div className="-mx-1 flex-1 overflow-y-auto px-1">
                    {groups.length === 0 && <div className="py-10 text-center text-sm text-muted">ยังไม่มีการแจ้งเตือน</div>}
                    {groups.map((g) => (
                        <div key={g.label}>
                            <div className="pt-2 pb-1 text-xs text-muted">{g.label}</div>
                            {g.items.map((n) => {
                                const [, Icon, tone] = n.kind
                                const [title, ...rest] = n.message.split(' · ')
                                return (
                                    <button key={n.id} onClick={() => go(n.link)} className="flex w-full items-start gap-3 border-b border-[#f0f2ef] py-3.5 text-left">
                                        <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${TONE[tone]}`}><Icon size={17} /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold">{title}</span>
                                            <span className="block text-xs text-muted">{[...rest, time(n.createdAt)].join(' · ')}</span>
                                        </span>
                                        {!n.readAt && <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-danger" />}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            </Drawer>

            {toast && (
                <button onClick={() => go(toast.link)} className="fixed right-4 bottom-24 z-[1100] max-w-sm rounded-2xl bg-ink px-4 py-3 text-left text-sm text-white shadow-xl md:bottom-6">
                    {toast.message}
                </button>
            )}
        </>
    )
}
