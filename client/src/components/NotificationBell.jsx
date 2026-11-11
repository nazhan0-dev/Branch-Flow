import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
    const [ring, setRing] = useState(0) // เพิ่มค่า = เล่น animation กระดิ่งใหม่ (ใช้เป็น key)
    const prevUnread = useRef(0)
    const navigate = useNavigate()

    // กระดิ่งสั่นเมื่อจำนวนที่ยังไม่อ่านเพิ่มขึ้น: มีแจ้งเตือนใหม่เข้ามา หรือเปิดหน้าแล้วมีเรื่องค้างอ่าน
    // สั่นครั้งเดียวต่อเหตุการณ์ ไม่วนไม่หยุด
    useEffect(() => {
        if (data.unread > prevUnread.current) setRing((r) => r + 1)
        prevUnread.current = data.unread
    }, [data.unread])

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

    // เปิดดูแล้วถือว่าอ่านแล้ว: ตัวเลขแดงหายทันที แต่จุดแดงหน้ารายการใหม่ยังแสดงจนกว่าจะปิด
    // จะได้ยังรู้ว่าอันไหนเพิ่งเข้ามา
    const [fresh, setFresh] = useState(() => new Set())
    const openDrawer = () => {
        setOpen(true)
        setFresh(new Set(data.items.filter((n) => !n.readAt).map((n) => n.id)))
        if (data.unread > 0) {
            prevUnread.current = 0 // ไม่ให้นับว่าเป็นแจ้งเตือนใหม่ตอนเลขกลับไปเป็น 0
            setData((d) => ({ ...d, unread: 0 }))
            readAll()
        }
    }
    const closeDrawer = () => {
        setOpen(false)
        setFresh(new Set())
    }
    // กดกล่องที่เด้งขึ้นมา (ไม่ได้เปิดรายการ) → อ่านเฉพาะรายการนั้น
    const openToast = (n) => {
        setToast(null)
        if (n.id) {
            setData((d) => ({ ...d, unread: Math.max(0, d.unread - 1), items: d.items.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)) }))
            prevUnread.current = Math.max(0, prevUnread.current - 1)
            api.post(`/notifications/${n.id}/read`).catch(() => {}).finally(load)
        }
        if (n.link) navigate(n.link)
    }
    const go = (link) => {
        closeDrawer()
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
                aria-label={data.unread ? `การแจ้งเตือน ยังไม่อ่าน ${data.unread} รายการ` : 'การแจ้งเตือน'}
                title="การแจ้งเตือน"
                onClick={openDrawer}
                className={`group relative grid size-10 shrink-0 place-items-center rounded-xl bg-white transition duration-200 hover:bg-soft active:scale-95 ${variant === 'rail' ? 'border border-line' : ''}`}
            >
                {/* วงแหวนกระจายออกหนึ่งครั้งตอนมีแจ้งเตือนใหม่ */}
                {ring > 0 && <span key={`ping-${ring}`} aria-hidden className="bl-ping pointer-events-none absolute inset-0 rounded-xl border-2 border-danger" />}
                <span key={`bell-${ring}`} className={`grid origin-[50%_8%] place-items-center ${ring > 0 ? 'bl-ring' : ''} group-hover:[animation:bl-ring_0.8s_ease-in-out]`}>
                    <Bell size={18} />
                </span>
                {data.unread > 0 && (
                    <span key={`badge-${ring}`} className={`${ring > 0 ? 'bl-badge-pop' : ''} absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white`}>
                        {data.unread > 99 ? '99+' : data.unread}
                    </span>
                )}
            </button>

            <Drawer open={open} onClose={closeDrawer}>
                <div className="flex items-center justify-between">
                    <h2 className="text-[26px] font-semibold">การแจ้งเตือน</h2>
                    <div className="flex items-center gap-2">
                        {data.unread > 0 && <button onClick={readAll} className="px-2 text-[13px] font-semibold">อ่านทั้งหมด</button>}
                        <button aria-label="ปิด" onClick={closeDrawer} className="grid size-9 place-items-center rounded-xl border border-line"><X size={18} /></button>
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
                                        {(!n.readAt || fresh.has(n.id)) && <span aria-label="ใหม่" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-danger" />}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            </Drawer>

            {toast && (
                <button key={toast.id ?? toast.message} role="status" onClick={() => openToast(toast)} className="bl-toast fixed right-4 bottom-24 z-[1150] max-w-sm rounded-2xl bg-ink px-4 py-3 text-left text-sm text-white shadow-xl md:bottom-6">
                    {toast.message}
                </button>
            )}
        </>
    )
}
