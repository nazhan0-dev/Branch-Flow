import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Store, Truck, Warehouse } from 'lucide-react'
import { errMsg } from '../api/client'
import { HOME, useAuth } from '../store/auth'
import { Button, ErrorBox } from '../components/ui'
import { LogoMark, Wordmark } from '../components/Logo'

// บัญชีทดลอง (seed จาก db/reset.js) กดการ์ดแล้วเติมอีเมล/รหัสให้
const DEMO = [
    { role: 'สาขา', who: 'สาขารามอินทรา', email: 'ramintra@bl.test', icon: Store },
    { role: 'คลังกลาง', who: 'Admin', email: 'admin@bl.test', icon: Warehouse },
    { role: 'คนขับ', who: 'สมชาย', email: 'somchai@bl.test', icon: Truck },
    { role: 'ผู้บริหาร', who: 'Executive', email: 'exec@bl.test', icon: BarChart3 },
]
const DEMO_PASSWORD = 'Demo@1234'

export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const login = useAuth((s) => s.login)
    const navigate = useNavigate()

    const submit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            const user = await login(email.trim(), password)
            navigate(HOME[user.role], { replace: true })
        } catch (err) {
            setError(errMsg(err))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="grid min-h-dvh place-items-center bg-canvas p-4">
            <div className="grid w-full max-w-4xl gap-4 md:grid-cols-[1fr_1.1fr]">
                <form onSubmit={submit} className="rounded-[28px] bg-white p-7">
                    <div className="mb-8 flex items-center gap-2.5">
                        <LogoMark size={44} />
                        <div>
                            <Wordmark className="text-lg" />
                            <div className="text-xs text-muted">ระบบเติมสินค้าและจัดส่งระหว่างสาขา</div>
                        </div>
                    </div>
                    <h1 className="text-[28px] font-semibold">เข้าสู่ระบบ</h1>
                    <p className="mb-6 text-sm text-muted">ใช้บัญชีที่ได้รับจากฝ่ายคลังกลาง</p>

                    <label className="mb-1.5 block text-sm font-medium">อีเมล</label>
                    <input className="mb-4 h-12 w-full rounded-xl border border-line px-4 outline-none focus:border-ink" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    <label className="mb-1.5 block text-sm font-medium">รหัสผ่าน</label>
                    <input className="mb-5 h-12 w-full rounded-xl border border-line px-4 outline-none focus:border-ink" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <ErrorBox>{error}</ErrorBox>
                    <Button type="submit" size="lg" loading={loading} className="mt-4 w-full">เข้าสู่ระบบ</Button>
                </form>

                <div className="rounded-[28px] bg-white/60 p-7">
                    <div className="mb-1 font-semibold">บัญชีทดลอง</div>
                    <p className="mb-5 text-sm text-muted">เลือกบทบาทเพื่อเติมข้อมูล · รหัสผ่าน {DEMO_PASSWORD}</p>
                    <div className="grid grid-cols-2 gap-3">
                        {DEMO.map(({ role, who, email: e, icon: Icon }) => (
                            <button
                                key={e}
                                type="button"
                                onClick={() => {
                                    setEmail(e)
                                    setPassword(DEMO_PASSWORD)
                                }}
                                className={`rounded-2xl border bg-white p-4 text-left transition hover:border-ink ${email === e ? 'border-ink' : 'border-transparent'}`}
                            >
                                <div className="mb-3 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-ink"><Icon size={20} /></div>
                                <div className="font-semibold">{role}</div>
                                <div className="text-xs text-muted">{who}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
