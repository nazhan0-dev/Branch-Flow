import { createPortal } from 'react-dom'
import { Minus, Plus } from 'lucide-react'

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
    <div className={`rounded-[22px] bg-white p-[18px] ${className}`} {...rest}>
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
        className={`inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${SIZE[size]} ${BTN[variant]} ${className}`}
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
    <div className={`min-w-0 flex-1 rounded-[20px] bg-white p-[18px] ${className}`}>
        <div className="flex items-center justify-between gap-2 text-sm text-muted">
            <span className="truncate">{label}</span>
            {badge}
        </div>
        <div className="mt-2.5 mb-1 truncate text-[30px] font-semibold leading-tight">{value}</div>
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

// แท็บแบบกล่องขาว ปุ่มที่เลือกเป็นพื้นดำ
export const Tabs = ({ items, value, onChange, className = '' }) => (
    <div className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white p-1 ${className}`}>
        {items.map(([k, label]) => (
            <button key={k} onClick={() => onChange(k)} className={`h-9 shrink-0 rounded-xl px-3.5 text-[13px] ${value === k ? 'bg-ink font-semibold text-white' : 'text-muted hover:text-ink'}`}>
                {label}
            </button>
        ))}
    </div>
)

// ตัวเลือกแบบปุ่มแบ่งช่อง (ปกติ/ด่วน, หมดอายุ/เสียหาย)
export const Segmented = ({ items, value, onChange, full }) => (
    <div className={`flex gap-2 ${full ? '' : 'flex-wrap'}`}>
        {items.map(([k, label]) => (
            <button
                key={k}
                type="button"
                onClick={() => onChange(k)}
                className={`h-[34px] rounded-[10px] px-3.5 text-[13px] ${full ? 'flex-1' : ''} ${value === k ? 'bg-ink font-semibold text-white' : 'border border-line bg-white'}`}
            >
                {label}
            </button>
        ))}
    </div>
)

export const Empty = ({ children }) => <div className="rounded-2xl bg-soft p-6 text-center text-sm text-muted">{children}</div>

export const ErrorBox = ({ children }) =>
    children ? <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">{children}</div> : null

export const Notice = ({ children, tone = 'warn' }) =>
    children ? <div className={`rounded-2xl px-4 py-3 text-[13px] ${TONES[tone]} font-normal`}>{children}</div> : null

export const Loading = () => <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>

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
            <tbody className="[&>tr]:border-b [&>tr]:border-[#f0f2ef] [&_td]:py-2.5 [&_td]:pr-3 [&_td:last-child]:pr-0">{children}</tbody>
        </table>
    </div>
)

// ชื่อสินค้าตัวหนา + รหัสสีจาง
export const Product = ({ name, sku }) => (
    <span>
        <b className="font-semibold">{name}</b> <span className="text-muted">{sku}</span>
    </span>
)

export const Bar = ({ pct, tone = 'brand', className = 'w-[120px]' }) => {
    const color = { brand: 'bg-brand', warn: 'bg-warn', danger: 'bg-danger', dark: 'bg-ink', gray: 'bg-[#9aa097]' }[tone]
    return (
        <div className={`h-2 overflow-hidden rounded bg-[#f1f3f0] ${className}`}>
            <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%`, minWidth: pct > 0 ? 3 : 0 }} />
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

// ไทม์ไลน์: done = จุดเขียวทึบ, now = วงเขียว, todo = วงเทา
export const Timeline = ({ items }) => (
    <div>
        {items.map((it, i) => (
            <div key={i} className="relative flex items-center gap-3 py-2">
                {i < items.length - 1 && <span className={`absolute top-1/2 left-[6px] h-full w-0.5 ${it.state === 'done' ? 'bg-brand' : 'bg-[#e3e6e1]'}`} />}
                <span
                    className={`relative size-3.5 shrink-0 rounded-full border-[3px] ${
                        it.state === 'done' ? 'border-brand bg-brand' : it.state === 'now' ? 'border-brand bg-white' : it.state === 'bad' ? 'border-danger bg-danger' : 'border-[#cfd3cd] bg-white'
                    }`}
                />
                <span className={`flex-1 text-sm ${it.state === 'todo' ? 'text-muted' : ''} ${it.state === 'now' || it.state === 'bad' ? 'font-semibold' : ''}`}>{it.label}</span>
                <span className={`text-xs ${it.tone === 'brand' ? 'text-brand-ink' : 'text-muted'}`}>{it.time}</span>
            </div>
        ))}
    </div>
)

// ลิ้นชักด้านขวา (ใช้กับการแจ้งเตือน)
export const Drawer = ({ open, onClose, children }) =>
    open && createPortal(
        <div className="fixed inset-0 z-[1200] flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="m-0 flex h-full w-full max-w-[440px] flex-col gap-3 overflow-hidden bg-white p-[22px] shadow-2xl sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-[28px]">{children}</div>
        </div>,
        document.body
    )

export const Modal = ({ open, onClose, title, children, width = 560 }) =>
    open && createPortal(
        <div className="fixed inset-0 z-[1200] grid place-items-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="max-h-[90vh] w-full overflow-y-auto rounded-[28px] bg-white p-6" style={{ maxWidth: width }}>
                {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
                {children}
            </div>
        </div>,
        document.body
    )

export const SearchInput = ({ value, onChange, placeholder, className = '' }) => (
    <label className={`flex h-11 items-center gap-2 rounded-[14px] border border-line bg-white px-3.5 text-sm ${className}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa097" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 outline-none placeholder:text-faint" />
    </label>
)
