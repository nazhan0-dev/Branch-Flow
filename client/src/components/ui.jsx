import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check as CheckIcon, ChevronDown, Minus, Plus, Search } from 'lucide-react'

const reducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        return false
    }
}

/**
 * ตัวเลขนับขึ้น: รับทั้งตัวเลขและข้อความที่มีตัวเลขอยู่ข้างใน ("฿15.8K", "100%", "1,250")
 * นับจากค่าเดิมไปค่าใหม่ คงรูปแบบเดิมไว้ (คำนำหน้า/ต่อท้าย, ทศนิยม, คอมมา) ข้อความที่ไม่มีตัวเลขแสดงตรง ๆ
 */
export const CountUp = ({ value, duration = 700 }) => {
    const text = String(value ?? '')
    // เวลา (14:30) และวันที่ (11/11) ไม่ใช่ปริมาณ ไม่ต้องนับ
    const m = /\d[:/]\d/.test(text) ? null : text.match(/^(\D*?)(-?[\d,]*\.?\d+)(.*)$/)
    const target = m ? Number(m[2].replace(/,/g, '')) : null
    const decimals = m && m[2].includes('.') ? m[2].split('.')[1].length : 0
    const comma = m ? m[2].includes(',') || Math.abs(target) >= 1000 : false
    const [shown, setShown] = useState(() => (target == null || reducedMotion() ? target : 0))
    const from = useRef(shown)

    useEffect(() => {
        if (target == null) return
        if (reducedMotion()) return setShown(target)
        const start = performance.now()
        const a = from.current ?? 0
        let raf
        const tick = (t) => {
            const k = Math.min((t - start) / duration, 1)
            const v = a + (target - a) * (1 - (1 - k) ** 3) // ease-out
            setShown(v)
            from.current = v
            if (k < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [target, duration])

    if (target == null) return text
    const n = Number(shown).toFixed(decimals)
    const [int, dec] = n.split('.')
    const intText = comma ? Number(int).toLocaleString('en-US') : int
    return `${m[1]}${intText}${dec ? `.${dec}` : ''}${m[3]}`
}

// ชุดคอมโพเนนต์พื้นฐาน ขนาดและสีตรงกับดีไซน์ใน Figma
const TONES = {
    brand: 'bg-brand-soft text-brand-ink',
    warn: 'bg-warn-soft text-warn-ink',
    danger: 'bg-danger-soft text-danger-ink',
    neutral: 'bg-[#eef0ed] text-[#5d625b]',
    dark: 'bg-ink text-white',
}

export const Badge = ({ tone = 'neutral', children, className = '' }) => (
    <span className={`inline-flex items-center whitespace-nowrap rounded-lg px-2 py-[3px] text-xs font-semibold ${TONES[tone]} ${className}`}>{children}</span>
)

export const StatusBadge = ({ map, value }) => {
    const [label, tone] = map[value] || [value, 'neutral']
    return <Badge tone={tone}>{label}</Badge>
}

export const Card = ({ className = '', children, ...rest }) => (
    <div className={`bl-card rounded-[22px] bg-white p-[18px] ${className}`} {...rest}>
        {children}
    </div>
)

const BTN = {
    primary: 'bg-ink text-white hover:bg-black',
    brand: 'bg-brand text-white hover:brightness-95',
    ghost: 'border border-line bg-white text-ink hover:bg-soft',
    chip: 'bg-white text-ink hover:bg-soft',
    soft: 'bg-[#2a2d2a] text-white hover:bg-[#333]',
    danger: 'border border-line bg-white text-danger-ink hover:bg-danger-soft',
}
const SIZE = {
    lg: 'h-[52px] rounded-2xl px-5 text-base',
    md: 'h-11 rounded-[14px] px-4 text-sm',
    sm: 'h-10 rounded-xl px-3.5 text-[13px]',
    xs: 'h-8 rounded-[10px] px-3 text-xs',
}

export const Button = ({ variant = 'primary', size = 'md', className = '', loading, children, ...rest }) => (
    <button
        className={`inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition duration-150 enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${SIZE[size]} ${BTN[variant]} ${className}`}
        disabled={loading || rest.disabled}
        {...rest}
    >
        {loading ? 'กำลังบันทึก…' : children}
    </button>
)

// value = null แสดงเป็น "–" (ยังไม่นับ)
export const Stepper = ({ value, onChange, min = 0, max = 99999, tone, start = 0, size = 'md' }) => {
    const border = tone === 'danger' ? 'border-danger' : tone === 'warn' ? 'border-warn' : 'border-line'
    const base = value ?? start
    const h = size === 'lg' ? 'h-11' : 'h-10'
    return (
        <div className={`inline-flex ${h} shrink-0 items-center self-start rounded-xl border bg-white ${border}`}>
            <button type="button" aria-label="ลด" className="grid h-full w-10 place-items-center" onClick={() => onChange(Math.max(min, value == null ? base : value - 1))}>
                <Minus size={16} />
            </button>
            <input
                className={`h-full w-11 border-x text-center text-base font-semibold outline-none ${border} ${value == null ? 'text-faint' : ''}`}
                inputMode="numeric"
                value={value ?? '–'}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '')
                    onChange(digits === '' ? min : Math.min(max, Math.max(min, Number(digits))))
                }}
            />
            <button type="button" aria-label="เพิ่ม" className="grid h-full w-10 place-items-center" onClick={() => onChange(Math.min(max, value == null ? base : value + 1))}>
                <Plus size={16} />
            </button>
        </div>
    )
}

export const Kpi = ({ label, value, sub, badge, className = '' }) => (
    <div className={`min-w-0 flex-1 bl-card bl-card-hover rounded-[20px] bg-white p-[18px] transition duration-200 hover:-translate-y-0.5 ${className}`}>
        <div className="flex items-center justify-between gap-2 text-sm text-muted">
            <span className="truncate">{label}</span>
            {badge}
        </div>
        <div className="mt-2.5 mb-1 truncate text-[30px] font-semibold leading-tight tabular-nums">{typeof value === 'string' || typeof value === 'number' ? <CountUp value={value} /> : value}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
    </div>
)

export const PageHeader = ({ title, sub, actions }) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight md:text-[30px]">{title}</h1>
            {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
)

// แท็บแบบกล่องขาว ปุ่มที่เลือกเป็นพื้นดำ (พื้นดำเลื่อนตามแท็บที่เลือก)
export const Tabs = ({ items, value, onChange, className = '' }) => {
    const box = useRef(null)
    const [pill, setPill] = useState(null)
    const labels = items.map(([, l]) => l).join('|')
    useLayoutEffect(() => {
        const measure = () => {
            const el = box.current?.querySelector('[data-active="true"]')
            setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
        }
        measure()
        const ro = new ResizeObserver(measure)
        if (box.current) ro.observe(box.current)
        return () => ro.disconnect()
    }, [value, labels])
    return (
        <div ref={box} role="tablist" className={`relative inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white p-1 ${className}`}>
            {pill && <span aria-hidden className="absolute top-1 bottom-1 rounded-xl bg-ink transition-all duration-300 ease-[var(--ease-out)]" style={{ left: pill.left, width: pill.width }} />}
            {items.map(([k, label]) => (
                <button
                    key={k}
                    role="tab"
                    aria-selected={value === k}
                    data-active={value === k}
                    onClick={() => onChange(k)}
                    className={`relative h-9 shrink-0 rounded-xl px-3.5 text-[13px] transition-colors duration-200 ${value === k ? 'font-semibold text-white' : 'text-muted hover:text-ink'} ${!pill && value === k ? 'bg-ink' : ''}`}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}

// ตัวเลือกแบบปุ่มแบ่งช่อง (ปกติ/ด่วน, หมดอายุ/เสียหาย)
export const Segmented = ({ items, value, onChange, full }) => (
    <div className={`flex gap-2 ${full ? '' : 'flex-wrap'}`}>
        {items.map(([k, label]) => (
            <button
                key={k}
                type="button"
                onClick={() => onChange(k)}
                className={`h-[34px] rounded-[10px] px-3.5 text-[13px] transition-colors duration-200 active:scale-[0.97] ${full ? 'flex-1' : ''} ${value === k ? 'bg-ink font-semibold text-white' : 'border border-line bg-white hover:bg-soft'}`}
            >
                {label}
            </button>
        ))}
    </div>
)

export const Empty = ({ children }) => <div className="bl-fade rounded-2xl bg-soft p-6 text-center text-sm text-muted">{children}</div>

export const ErrorBox = ({ children }) =>
    children ? <div role="alert" className="bl-pop rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">{children}</div> : null

export const Notice = ({ children, tone = 'warn' }) =>
    children ? <div className={`rounded-2xl px-4 py-3 text-[13px] ${TONES[tone]} font-normal`}>{children}</div> : null

// โครงหน้าระหว่างโหลด (หัวเรื่อง + การ์ดตัวเลข + การ์ดใหญ่) แทนข้อความเฉย ๆ
const Sk = ({ className }) => <div className={`bl-skeleton rounded-[14px] ${className}`} />
export const Loading = () => (
    <div className="bl-fade flex flex-col gap-4" role="status" aria-label="กำลังโหลด">
        <div className="flex flex-col gap-2">
            <Sk className="h-8 w-56" />
            <Sk className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-[112px] rounded-[20px]" />)}
        </div>
        <Sk className="h-[320px] rounded-[22px]" />
        <span className="sr-only">กำลังโหลด…</span>
    </div>
)

export const Table = ({ head, children, minWidth = 640 }) => (
    <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
            <thead>
                <tr className="border-b border-[#eef0ed] text-left text-faint">
                    {head.map((h, i) => (
                        <th key={i} className={`py-2 pr-3 font-medium ${h.right ? 'text-right' : ''} last:pr-0`}>
                            {h.label ?? h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-[#f0f2ef] [&>tr]:transition-colors [&>tr]:duration-150 [&_td]:py-2.5 [&_td]:pr-3 [&_td:last-child]:pr-0">{children}</tbody>
        </table>
    </div>
)

// ชื่อสินค้าตัวหนา + รหัสสีจาง
export const Product = ({ name, sku }) => (
    <span>
        <b className="font-semibold">{name}</b> <span className="text-muted">{sku}</span>
    </span>
)

// แถบวิ่งจาก 0 ตอนเลื่อนมาเห็นครั้งแรก (การ์ดที่อยู่ล่างจอจะไม่วิ่งจบไปก่อนผู้ใช้เห็น)
const useSeen = () => {
    const ref = useRef(null)
    const [seen, setSeen] = useState(false)
    useEffect(() => {
        const el = ref.current
        if (!el || seen) return
        if (typeof IntersectionObserver === 'undefined') return setSeen(true)
        const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.6 })
        io.observe(el)
        return () => io.disconnect()
    }, [seen])
    return [ref, seen]
}
export const Bar = ({ pct, tone = 'brand', className = 'w-[120px]' }) => {
    const color = { brand: 'bg-brand', warn: 'bg-warn', danger: 'bg-danger', dark: 'bg-ink', gray: 'bg-[#9aa097]' }[tone]
    const [ref, seen] = useSeen()
    const w = seen ? Math.max(0, Math.min(pct, 100)) : 0
    return (
        <div ref={ref} className={`h-2 overflow-hidden rounded bg-[#f1f3f0] ${className}`}>
            <div className={`bl-bar h-full rounded ${color}`} style={{ width: `${w}%`, minWidth: seen && pct > 0 ? 3 : 0 }} />
        </div>
    )
}

const AVATAR = {
    blue: 'bg-[#e9ecf7] text-[#3a4bb0]',
    green: 'bg-brand-soft text-brand-ink',
    amber: 'bg-warn-soft text-warn-ink',
}
export const Avatar = ({ name = '', tone = 'blue', size = 40 }) => (
    <div className={`grid shrink-0 place-items-center rounded-full text-sm font-bold ${AVATAR[tone]}`} style={{ width: size, height: size }}>
        {initials(name)}
    </div>
)
// "สมชาย ใจดี" → "สม", "Admin" → "AD"
export const initials = (name) => {
    const n = String(name).trim()
    if (/^[a-z]/i.test(n)) return n.slice(0, 2).toUpperCase()
    return n.replace(/[่-๋็์ัิ-ฺ]/g, '').slice(0, 2)
}

export const Num = ({ n, tone = 'dark' }) => (
    <span className={`grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold text-white ${tone === 'danger' ? 'bg-danger' : tone === 'muted' ? 'bg-faint' : 'bg-ink'}`}>{n}</span>
)

export const Check = ({ on }) => <span className={`size-5 shrink-0 rounded-md border-[1.5px] ${on ? 'border-ink bg-ink' : 'border-[#cfd3cd] bg-white'}`} />

// ไทม์ไลน์: done = จุดเขียวมีถูก · now = วงเขียวมีวงแหวนกระจาย · todo = วงขาวขอบเทา · bad = จุดแดง
// เส้นเชื่อมเว้นช่องห่างจากจุด (ไม่ทับจุด) · จุดเด้งขึ้นทีละจุด แล้วเส้นค่อย ๆ ยืดลงไปหาจุดถัดไป
const TL_DOT = {
    done: 'bg-brand text-white',
    now: 'bl-tl-now border-[3px] border-brand bg-white',
    bad: 'bg-danger text-white',
    todo: 'border-2 border-[#cfd3cd] bg-white',
}
export const Timeline = ({ items }) => (
    <ol>
        {items.map((it, i) => (
            <li key={i} className="relative flex items-center gap-3 py-2" style={{ '--d': `${i * 110}ms` }}>
                {i < items.length - 1 && (
                    <span
                        aria-hidden
                        className={`bl-tl-line absolute top-[calc(50%+14px)] left-[7px] h-[calc(100%-28px)] w-[2px] rounded-full ${it.state === 'done' ? 'bg-brand' : 'bg-line'}`}
                    />
                )}
                {/* ขอบนอก: ช่องขาว 2px แล้วเส้นเทาอ่อน 1.5px รอบจุด */}
                <span aria-hidden className={`bl-tl-dot relative grid size-4 shrink-0 place-items-center rounded-full shadow-[0_0_0_2px_#fff,0_0_0_3.5px_var(--color-line)] ${TL_DOT[it.state] || TL_DOT.todo}`}>
                    {it.state === 'done' && <CheckIcon size={10} strokeWidth={4} />}
                    {it.state === 'bad' && <span className="text-[10px] leading-none font-bold">!</span>}
                </span>
                <span className={`flex-1 text-sm ${it.state === 'todo' ? 'text-muted' : ''} ${it.state === 'now' || it.state === 'bad' ? 'font-semibold' : ''}`}>{it.label}</span>
                <span className={`text-xs ${it.tone === 'brand' ? 'text-brand-ink' : 'text-muted'}`}>{it.time}</span>
            </li>
        ))}
    </ol>
)

// ลิ้นชักด้านขวา (ใช้กับการแจ้งเตือน)
export const Drawer = ({ open, onClose, children }) =>
    open && createPortal(
        <div className="bl-backdrop fixed inset-0 z-[1200] flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="bl-slide-left m-0 flex h-full w-full max-w-[440px] flex-col gap-3 overflow-hidden bg-white p-[22px] shadow-2xl sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-[28px]">{children}</div>
        </div>,
        document.body
    )

export const Modal = ({ open, onClose, title, children, width = 560 }) =>
    open && createPortal(
        <div className="bl-backdrop fixed inset-0 z-[1200] grid place-items-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div role="dialog" aria-modal="true" className="bl-pop max-h-[90vh] w-full overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl" style={{ maxWidth: width }}>
                {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
                {children}
            </div>
        </div>,
        document.body
    )

/**
 * Dropdown แทน <select> ของเบราว์เซอร์ (ซึ่งตกแต่งรายการที่เปิดออกมาไม่ได้)
 * options  = [[value, label], ...] หรือ [{ value, label, hint }]
 * variant  = 'field' (กรอบแบบช่องกรอก) · 'pill' (กล่องขาวมีเงา ใช้บนแถบเครื่องมือ) · 'ghost' (ตัวหนังสือเฉย ๆ เช่นหัวการ์ด)
 * label    = ข้อความนำหน้าในปุ่ม เช่น "สถานะ"
 * รายการเกิน 8 ตัวมีช่องค้นหา · เปิดด้วย portal (ไม่ถูก Modal ตัดขอบ) · ที่ด้านล่างไม่พอจะเปิดขึ้นบน
 */
const SELECT_TRIGGER = {
    field: 'h-11 w-full justify-between rounded-xl border border-line bg-white px-3.5 text-sm hover:border-[#cfd3cd]',
    pill: 'h-11 rounded-[14px] bg-white px-3.5 text-sm shadow-sm hover:bg-soft',
    ghost: '-ml-1 rounded-lg px-1 text-lg font-semibold hover:bg-soft',
}
// small: เมนูกว้างเท่าปุ่มและแถวเตี้ยลง — ใช้กับตัวเลือกสั้น ๆ ไม่กี่ตัว
export const Select = ({ value, onChange, options, placeholder = 'เลือก', label, variant = 'field', align = 'left', className = '', ariaLabel, small }) => {
    const opts = options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : o))
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const [active, setActive] = useState(0)
    const [pos, setPos] = useState(null)
    const btn = useRef(null)
    const menu = useRef(null)
    const id = useId()
    const searchable = opts.length > 8
    const shown = q ? opts.filter((o) => String(o.label).toLowerCase().includes(q.trim().toLowerCase())) : opts
    const current = opts.find((o) => String(o.value) === String(value))

    const place = () => {
        const r = btn.current?.getBoundingClientRect()
        if (!r) return
        const below = window.innerHeight - r.bottom
        const up = below < 260 && r.top > below
        setPos({
            left: align === 'right' ? undefined : r.left,
            right: align === 'right' ? window.innerWidth - r.right : undefined,
            top: up ? undefined : r.bottom + 6,
            bottom: up ? window.innerHeight - r.top + 6 : undefined,
            minWidth: small ? r.width : Math.max(r.width, 180),
            maxHeight: Math.min(320, (up ? r.top : below) - 16),
        })
    }
    const openMenu = () => {
        place()
        setQ('')
        setActive(Math.max(0, opts.findIndex((o) => String(o.value) === String(value))))
        setOpen(true)
    }
    const close = (focusBack = true) => {
        setOpen(false)
        if (focusBack) btn.current?.focus()
    }
    const pick = (o) => {
        onChange(o.value)
        close()
    }

    useEffect(() => {
        if (!open) return
        const onDown = (e) => !menu.current?.contains(e.target) && !btn.current?.contains(e.target) && close(false)
        document.addEventListener('mousedown', onDown)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true) // เลื่อนหน้า/Modal แล้วเมนูตามปุ่มไป
        return () => {
            document.removeEventListener('mousedown', onDown)
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])
    useEffect(() => {
        if (open) menu.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
    }, [active, open])

    const onKey = (e) => {
        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
                e.preventDefault()
                openMenu()
            }
            return
        }
        if (e.key === 'Escape') {
            e.preventDefault()
            close()
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(shown.length - 1, a + 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
        } else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
            e.preventDefault()
            if (shown[active]) pick(shown[active])
        } else if (e.key === 'Tab') close(false)
    }

    return (
        <>
            <button
                ref={btn}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? `${id}-list` : undefined}
                aria-label={ariaLabel || (label ? `${label}: ${current?.label ?? placeholder}` : undefined)}
                onClick={() => (open ? close() : openMenu())}
                onKeyDown={onKey}
                className={`inline-flex min-w-0 items-center gap-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ink/20 ${SELECT_TRIGGER[variant]} ${className}`}
            >
                {label && <span className="shrink-0 text-muted">{label}</span>}
                <span className={`truncate ${variant !== 'ghost' ? 'font-semibold' : ''} ${current ? '' : 'text-faint'}`}>{current?.label ?? placeholder}</span>
                <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && pos && createPortal(
                <div
                    ref={menu}
                    className={`bl-pop fixed z-[1300] flex flex-col overflow-hidden border border-line bg-white shadow-[0_12px_32px_rgba(20,22,20,0.14)] ${small ? 'rounded-xl p-1' : 'rounded-2xl p-1.5'}`}
                    style={{ left: pos.left, right: pos.right, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxWidth: 'calc(100vw - 24px)', maxHeight: pos.maxHeight }}
                >
                    {searchable && (
                        <label className="mb-1 flex h-9 shrink-0 items-center gap-2 rounded-xl bg-soft px-2.5 text-sm">
                            <Search size={15} className="text-faint" />
                            <input
                                autoFocus
                                value={q}
                                onChange={(e) => {
                                    setQ(e.target.value)
                                    setActive(0)
                                }}
                                onKeyDown={onKey}
                                placeholder="ค้นหา…"
                                aria-label="ค้นหาในรายการ"
                                aria-controls={`${id}-list`}
                                aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
                                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
                            />
                        </label>
                    )}
                    <div id={`${id}-list`} role="listbox" aria-activedescendant={shown[active] ? `${id}-${active}` : undefined} className="overflow-y-auto overscroll-contain">
                        {shown.length === 0 && <div className="px-3 py-3 text-center text-sm text-muted">ไม่พบรายการ</div>}
                        {shown.map((o, i) => {
                            const selected = String(o.value) === String(value)
                            return (
                                <div
                                    key={String(o.value)}
                                    id={`${id}-${i}`}
                                    data-i={i}
                                    role="option"
                                    aria-selected={selected}
                                    onMouseEnter={() => setActive(i)}
                                    onMouseDown={(e) => e.preventDefault()} // ไม่ให้ปุ่มเสียโฟกัสก่อนเลือก
                                    onClick={() => pick(o)}
                                    className={`flex cursor-pointer items-center justify-between gap-3 ${small ? 'rounded-lg px-2.5 py-1.5 text-[13px]' : 'rounded-xl px-3 py-2 text-sm'} transition-colors duration-100 ${i === active ? 'bg-soft' : ''} ${selected ? 'font-semibold' : ''}`}
                                >
                                    <span className="min-w-0 truncate">{o.label}</span>
                                    <span className="flex shrink-0 items-center gap-2">
                                        {o.hint != null && <span className="text-xs font-normal text-muted">{o.hint}</span>}
                                        <CheckIcon size={small ? 14 : 16} className={`text-brand ${selected ? '' : 'invisible'}`} />
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

export const SearchInput =({ value, onChange, placeholder, className = '' }) => (
    <label className={`flex h-11 items-center gap-2 rounded-[14px] border border-line bg-white px-3.5 text-sm transition-shadow duration-200 focus-within:border-ink/30 focus-within:shadow-[0_0_0_4px_rgba(20,22,20,0.06)] ${className}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa097" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 outline-none placeholder:text-faint" />
    </label>
)
