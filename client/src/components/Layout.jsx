import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, ClipboardList, FileText, Home, Layers, LayoutPanelLeft, LogOut, Map, Package, Store, Truck, User, Clock } from 'lucide-react'
import { useAuth } from '../store/auth'
import { disconnectSocket } from '../lib/socket'
import NotificationBell from './NotificationBell'
import { Avatar } from './ui'

// เมนูตามบทบาท (ลำดับเดียวกับดีไซน์) match = path อื่นที่ให้ไอคอนนี้ active ด้วย
const MENUS = {
    branch: [
        { to: '/branch', label: 'หน้าหลัก', icon: Home, end: true },
        { to: '/branch/stock', label: 'สต็อก / สั่งของ', icon: Layers, match: ['/branch/order'] },
        { to: '/branch/requests', label: 'ประวัติคำขอ', icon: FileText, match: ['/branch/receive'] },
        { to: '/branch/track', label: 'ติดตามรถ', icon: Map },
    ],
    admin: [
        { to: '/admin/trips', label: 'แผนที่ติดตามรถ', icon: Map },
        { to: '/admin/requests', label: 'คำขอเติมสินค้า', icon: LayoutPanelLeft },
        { to: '/admin/planner', label: 'จัดเที่ยวส่ง', icon: Truck },
        { to: '/admin/warehouse', label: 'สต็อกคลังกลาง', icon: Package },
        { to: '/admin/branches', label: 'สาขา', icon: Store },
        { to: '/admin/overview', label: 'ภาพรวม', icon: BarChart3 },
    ],
    executive: [
        { to: '/exec', label: 'ภาพรวม', end: true },
        { to: '/exec/branches', label: 'สาขา', icon: Store },
        { to: '/exec/trips', label: 'แผนที่ติดตามรถ' },
    ],
    driver: [
        { to: '/driver', label: 'งาน', icon: ClipboardList, end: true, match: ['/driver/trips'] },
        { to: '/driver/map', label: 'แผนที่', icon: Map },
        { to: '/driver/history', label: 'ประวัติ', icon: Clock },
        { to: '/driver/profile', label: 'โปรไฟล์', icon: User },
    ],
}
const ROLE_LABEL = { branch: 'พนักงานสาขา', admin: 'คลังกลาง', driver: 'คนขับ', executive: 'ผู้บริหาร' }

// ใช้ JS เลือกว่าจะแสดงแถบมือถือหรือแถบเดสก์ท็อป (ไม่ซ่อนด้วย CSS) กระดิ่งจะได้มีตัวเดียว
const useWide = (px) => {
    const q = `(min-width: ${px}px)`
    const [wide, setWide] = useState(() => window.matchMedia(q).matches)
    useEffect(() => {
        const m = window.matchMedia(q)
        const on = () => setWide(m.matches)
        m.addEventListener('change', on)
        return () => m.removeEventListener('change', on)
    }, [q])
    return wide
}

const useActive = () => {
    const { pathname } = useLocation()
    return (m) => (m.end ? pathname === m.to : pathname.startsWith(m.to)) || (m.match || []).some((p) => pathname.startsWith(p))
}

const Logo = ({ size = 36 }) => (
    <div className="grid shrink-0 place-items-center rounded-xl bg-ink font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.42 }}>BL</div>
)

export default function Layout({ children }) {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    const isActive = useActive()
    const menu = MENUS[user.role]
    const wide = useWide(user.role === 'executive' ? 1024 : 768)

    const onLogout = async () => {
        disconnectSocket()
        await logout()
        navigate('/login', { replace: true })
    }

    // คนขับ: หน้าจอมือถือ + แถบเมนูล่าง
    if (user.role === 'driver') {
        return (
            <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-canvas">
                <main className="flex-1 pb-[84px]">{children}</main>
                <nav className="fixed inset-x-0 bottom-0 z-[600] mx-auto flex h-[76px] max-w-[430px] justify-around border-t border-[#eef0ed] bg-white pt-3">
                    {menu.map((m) => {
                        const Icon = m.icon
                        const on = isActive(m)
                        return (
                            <NavLink key={m.to} to={m.to} className={`flex w-16 flex-col items-center gap-1 text-[11px] ${on ? 'font-semibold text-ink' : 'text-faint'}`}>
                                <Icon size={22} />
                                {m.label}
                            </NavLink>
                        )
                    })}
                </nav>
            </div>
        )
    }

    // ผู้บริหาร: แถบเมนูกว้างมีชื่อเมนู
    if (user.role === 'executive') {
        return (
            <div className="flex min-h-dvh gap-5 bg-canvas p-3 md:p-5">
                {wide ? (
                <aside className="sticky top-5 flex h-[calc(100dvh-40px)] w-[232px] shrink-0 flex-col rounded-[22px] bg-white p-4">
                    <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
                        <Logo size={30} />
                        <span className="text-[15px] font-semibold">Branch Logistics</span>
                    </div>
                    <nav className="space-y-1">
                        {menu.map((m) => (
                            <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive: on }) => `flex h-[42px] items-center gap-3 rounded-xl px-3 text-sm ${on ? 'bg-soft font-semibold' : 'text-[#4a4f48] hover:bg-soft'}`}>
                                {({ isActive: on }) => (
                                    <>
                                        <span className={`size-[18px] rounded-[5px] border-[1.5px] ${on ? 'border-ink bg-ink' : 'border-[#cfd3cd]'}`} />
                                        {m.label}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="mt-auto border-t border-[#f0f2ef] pt-4">
                        <div className="flex items-center gap-3 px-1">
                            <Avatar name={user.name.replace(/^คุณ/, '')} tone="amber" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{user.name}</div>
                                <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
                            </div>
                            <NotificationBell />
                        </div>
                        <button onClick={onLogout} className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-soft"><LogOut size={16} /> ออกจากระบบ</button>
                    </div>
                </aside>
                ) : (
                    <MobileTop user={user} onLogout={onLogout} />
                )}
                <main className={`flex min-w-0 flex-1 flex-col gap-4 ${wide ? '' : 'pt-14 pb-20'}`}>{children}</main>
                {!wide && <MobileNav menu={menu} isActive={isActive} />}
            </div>
        )
    }

    // สาขา / คลัง: แถบไอคอนด้านซ้าย
    return (
        <div className="flex min-h-dvh gap-5 bg-canvas p-3 md:p-5">
            {wide ? (
            <aside className="sticky top-5 flex h-[calc(100dvh-40px)] w-16 shrink-0 flex-col items-center gap-3.5 rounded-[22px] bg-white py-[18px]">
                <div className="mb-2.5"><Logo /></div>
                {menu.map((m) => {
                    const Icon = m.icon
                    const on = isActive(m)
                    return (
                        <NavLink key={m.to} to={m.to} title={m.label} aria-label={m.label} className={`grid size-10 place-items-center rounded-xl border ${on ? 'border-ink bg-ink text-white' : 'border-line text-ink hover:bg-soft'}`}>
                            <Icon size={18} />
                        </NavLink>
                    )
                })}
                <div className="mt-auto flex flex-col items-center gap-3.5">
                    <NotificationBell />
                    <button onClick={onLogout} title={`${user.name} · ออกจากระบบ`} className="group relative">
                        <Avatar name={user.role === 'admin' ? 'AD' : user.name.split(' ').at(-1).replace(/^สาขา/, '')} tone="green" />
                        <span className="absolute inset-0 hidden place-items-center rounded-full bg-ink/80 text-white group-hover:grid"><LogOut size={16} /></span>
                    </button>
                </div>
            </aside>
            ) : (
                <MobileTop user={user} onLogout={onLogout} />
            )}
            <main className={`flex min-w-0 flex-1 flex-col gap-4 ${wide ? '' : 'pt-14 pb-24'}`}>{children}</main>
            {!wide && <MobileNav menu={menu} isActive={isActive} />}
        </div>
    )
}

// มือถือ: แถบบน (โลโก้ + กระดิ่ง + ออก) และแถบเมนูล่าง
const MobileTop = ({ user, onLogout, className = '' }) => (
    <header className={`fixed inset-x-0 top-0 z-[600] flex items-center justify-between bg-canvas/95 px-3 py-2.5 backdrop-blur ${className}`}>
        <div className="flex items-center gap-2">
            <Logo size={32} />
            <span className="text-sm font-semibold">{user.name}</span>
        </div>
        <div className="flex items-center gap-2">
            <NotificationBell variant="plain" />
            <button aria-label="ออกจากระบบ" onClick={onLogout} className="grid size-10 place-items-center rounded-xl bg-white"><LogOut size={18} /></button>
        </div>
    </header>
)

const MobileNav = ({ menu, isActive, className = '' }) => (
    <nav className={`fixed inset-x-0 bottom-0 z-[600] flex justify-around border-t border-[#eef0ed] bg-white py-2 ${className}`}>
        {menu.map((m) => {
            const Icon = m.icon || BarChart3
            const on = isActive(m)
            return (
                <NavLink key={m.to} to={m.to} className={`flex flex-col items-center gap-0.5 px-2 text-[11px] ${on ? 'font-semibold text-ink' : 'text-faint'}`}>
                    <Icon size={20} />
                    {m.label.split(' ')[0]}
                </NavLink>
            )
        })}
    </nav>
)
