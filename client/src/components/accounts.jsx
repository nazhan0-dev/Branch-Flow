import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import api, { errMsg } from '../api/client'
import { Button, ErrorBox, Modal, Notice } from './ui'

/**
 * ส่วนที่ใช้ร่วมกันของฟอร์มจัดการบัญชี (หน้ารถและคนขับ, หน้าสาขา)
 * ช่องกรอก, รหัสผ่านชั่วคราว, หน้าต่างโชว์อีเมล/รหัส, ตั้งรหัสใหม่, ยืนยันก่อนทำ
 */

export const FIELD = 'h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm outline-none transition-shadow placeholder:text-faint focus:border-ink/30 focus:shadow-[0_0_0_4px_rgba(20,22,20,0.06)]'
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// รหัสผ่านชั่วคราวอ่านง่าย (ตัด 0/O, 1/l/I ที่สับสน) ใช้ crypto ของเบราว์เซอร์ ไม่ใช้ Math.random
export const tempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const pick = (n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join('')
    return `${pick(4)}-${pick(4)}`
}

// group = ช่องที่มีปุ่มหลายปุ่ม (ตัวเลือก / dropdown) ใช้ div + role=group แทน label ไม่ให้ชื่อปุ่มปนกัน
export const Field = ({ label, hint, group, children }) => {
    const Tag = group ? 'div' : 'label'
    return (
        <Tag className="flex min-w-0 flex-col gap-1.5" {...(group ? { role: 'group', 'aria-label': label } : {})}>
            <span className="text-xs font-medium text-[#4a4f48]">{label}</span>
            {children}
            {hint && <span className="text-[11px] text-faint">{hint}</span>}
        </Tag>
    )
}

// ช่องรหัสผ่าน + ปุ่มสุ่มรหัสใหม่
export const PasswordInput = ({ label, value, onChange }) => (
    <div className="flex gap-2">
        <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} maxLength={72} className={`${FIELD} font-mono`} autoComplete="new-password" />
        <Button variant="ghost" type="button" onClick={() => onChange(tempPassword())} aria-label="สุ่มรหัสใหม่"><RefreshCw size={15} /></Button>
    </div>
)

/**
 * ตั้งรหัสผ่านใหม่ให้บัญชีอื่น (คนขับ / พนักงานสาขา)
 * user = { id, name, email } · endpoint = API ที่รับ { password } · who = ใช้ในข้อความ เช่น "คนขับ"
 */
export function PasswordModal({ user, endpoint, who, onClose, onDone }) {
    const [pw, setPw] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (user) {
            setPw(tempPassword())
            setErr('')
        }
    }, [user])
    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            await api.post(endpoint, { password: pw })
            onDone({ name: user.name, email: user.email, password: pw })
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal open={!!user} onClose={onClose} title={user ? `ตั้งรหัสผ่านใหม่ · ${user.name}` : ''} width={440}>
            <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">ใช้เมื่อ{who}ลืมรหัส รหัสเดิมจะใช้ไม่ได้ทันที และเครื่องที่ล็อกอินค้างไว้จะถูกออกจากระบบ</p>
                <Field label="รหัสผ่านใหม่" group hint="อย่างน้อย 8 ตัวอักษร">
                    <PasswordInput label="รหัสผ่านใหม่" value={pw} onChange={setPw} />
                </Field>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={pw.length < 8} loading={busy} onClick={save}>บันทึกรหัสใหม่</Button>
            </div>
        </Modal>
    )
}

/**
 * แสดงอีเมลและรหัสให้ Admin ส่งต่อ (ครั้งเดียว ระบบเก็บแค่ค่า hash ไม่เก็บรหัสจริง)
 * cred = { name, email, password, isNew, note? } · who = ใช้ในข้อความ เช่น "คนขับ" / "พนักงานสาขา"
 */
export function CredentialModal({ cred, who, onClose }) {
    const [copied, setCopied] = useState(false)
    useEffect(() => setCopied(false), [cred])
    if (!cred) return null
    const text = `BranchFlow · บัญชี${who}\nอีเมล: ${cred.email}\nรหัสผ่าน: ${cred.password}`
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }
    return (
        <Modal open onClose={onClose} title={cred.isNew ? `สร้างบัญชี ${cred.name} แล้ว` : `ตั้งรหัสใหม่ให้ ${cred.name} แล้ว`} width={440}>
            <div className="flex flex-col gap-4">
                {cred.note && <div className="text-sm text-muted">{cred.note}</div>}
                <div className="rounded-2xl bg-soft p-4 text-sm">
                    <div className="text-xs text-muted">อีเมล</div>
                    <div className="mb-2 font-semibold">{cred.email}</div>
                    <div className="text-xs text-muted">รหัสผ่าน</div>
                    <div className="font-mono text-lg font-semibold tracking-wide">{cred.password}</div>
                </div>
                <Notice tone="warn">ส่งข้อมูลนี้ให้{who}ตอนนี้ ระบบเก็บรหัสแบบเข้ารหัส ปิดหน้าต่างแล้วจะดูรหัสนี้อีกไม่ได้</Notice>
                <div className="flex gap-2.5">
                    <Button variant="ghost" size="lg" className="flex-1" onClick={copy}><Copy size={16} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</Button>
                    <Button size="lg" className="flex-1" onClick={onClose}>เสร็จ</Button>
                </div>
            </div>
        </Modal>
    )
}

/** ยืนยันก่อนทำสิ่งที่ย้อนยาก · c = { title, body, ok, run } */
export function ConfirmModal({ c, onClose }) {
    const [busy, setBusy] = useState(false)
    if (!c) return null
    return (
        <Modal open onClose={onClose} title={c.title} width={420}>
            <p className="mb-5 text-sm text-muted">{c.body}</p>
            <div className="flex gap-2.5">
                <Button variant="ghost" size="lg" className="flex-1" onClick={onClose}>ยกเลิก</Button>
                <Button
                    variant="danger"
                    size="lg"
                    className="flex-1"
                    loading={busy}
                    onClick={async () => {
                        setBusy(true)
                        await c.run()
                        setBusy(false)
                        onClose()
                    }}
                >
                    {c.ok}
                </Button>
            </div>
        </Modal>
    )
}
