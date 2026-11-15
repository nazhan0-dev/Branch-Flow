import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, MapPin, PackageCheck, RefreshCw } from 'lucide-react'
import { errMsg } from '../api/client'
import { HOME, useAuth } from '../store/auth'
import { Button, ErrorBox } from '../components/ui'
import { LogoMark, Wordmark } from '../components/Logo'

// จุดเด่นของระบบ (แผงซ้าย)
const FEATURES = [
    [RefreshCw, 'เติมสินค้าอัตโนมัติ', 'ของใกล้หมด ระบบร่างคำขอให้สาขาทันที'],
    [MapPin, 'ติดตามรถแบบเรียลไทม์', 'เห็นตำแหน่งรถและเวลาถึงของทุกเที่ยว'],
    [PackageCheck, 'นับและรับของในที่เดียว', 'แจ้งของขาดหรือเสียหายตอนรับได้เลย'],
]

// ช่องกรอกพร้อมไอคอนด้านหน้า (และปุ่มด้านท้ายถ้ามี)
const Field = ({ icon: Icon, label, end, ...rest }) => (
    <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{label}</span>
        <span className="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 transition-shadow focus-within:border-ink/40 focus-within:shadow-[0_0_0_4px_rgba(20,22,20,0.06)]">
            <Icon size={18} className="shrink-0 text-faint" />
            <input className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" {...rest} />
            {end}
        </span>
    </label>
)

// ภาพประกอบ: คลัง (จุดดำ) ส่งของไปหลายสาขา
//  1) เส้นทางวาดออกจากคลัง  2) จุดสาขาเด้งขึ้นทีละจุด  3) เส้นประวิ่ง + รถ (จุดขาว) วิ่งไปตามเส้นวนไปเรื่อย ๆ
const ROUTE_A = 'M40 180C90 180 80 110 150 110S230 50 300 50'
const ROUTE_B = 'M150 110C200 110 220 170 310 170'
const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const RouteArt = () => (
    <svg viewBox="0 0 360 220" className="w-full" aria-hidden>
        <g fill="none" stroke="#fff" strokeLinecap="round">
            <path className="bl-draw" pathLength="1" d={ROUTE_A} strokeOpacity=".35" strokeWidth="10" style={{ animationDelay: '250ms' }} />
            <path className="bl-draw" pathLength="1" d={ROUTE_B} strokeOpacity=".35" strokeWidth="10" style={{ animationDelay: '700ms' }} />
            <path className="bl-dash" d={ROUTE_A} strokeWidth="3" strokeDasharray="2 12" style={{ '--d': '1200ms' }} />
            <path className="bl-dash" d={ROUTE_B} strokeWidth="3" strokeDasharray="2 12" style={{ '--d': '1400ms' }} />
        </g>
        {/* รถวิ่งตามเส้นทาง (ปิดเมื่อผู้ใช้ตั้งค่าลดการเคลื่อนไหว) */}
        {!still &&
            [[ROUTE_A, '0s'], [ROUTE_B, '2.2s']].map(([d, begin]) => (
                <circle key={begin} r="6" fill="#fff" opacity="0">
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="4.4s" begin={`${1.6 + parseFloat(begin)}s`} repeatCount="indefinite" />
                    <animateMotion path={d} dur="4.4s" begin={`${1.6 + parseFloat(begin)}s`} repeatCount="indefinite" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.4 0 0.2 1" />
                </circle>
            ))}
        <g className="bl-dot-pop" style={{ '--d': '100ms' }}>
            <circle cx="40" cy="180" r="13" fill="#141614" />
            <circle cx="40" cy="180" r="5" fill="#fff" />
        </g>
        {[[150, 110, 650], [300, 50, 1000], [310, 170, 1150]].map(([x, y, d]) => (
            <g key={`${x}-${y}`} className="bl-dot-pop" style={{ '--d': `${d}ms` }}>
                <circle cx={x} cy={y} r="13" fill="#fff" />
                <circle cx={x} cy={y} r="5" fill="#22a45d" />
            </g>
        ))}
    </svg>
)

export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [show, setShow] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [shake, setShake] = useState(0) // นับครั้งที่เข้าสู่ระบบไม่ผ่าน (ใช้เล่นอนิเมชันสั่น)
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
            setShake((n) => n + 1)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="grid min-h-dvh place-items-center bg-canvas p-4">
            <div className="bl-pop grid w-full max-w-[960px] overflow-hidden rounded-[32px] bg-white shadow-[0_24px_60px_rgba(20,22,20,0.10)] md:grid-cols-[1.05fr_1fr]">
                {/* แผงแบรนด์ (ซ่อนบนมือถือ) */}
                <aside className="relative isolate hidden flex-col justify-between overflow-hidden bg-brand p-9 text-white md:flex">
                    {/* วงกลมจาง ๆ ตกแต่งพื้นหลัง */}
                    <span aria-hidden className="bl-float absolute -top-24 -right-24 size-72 rounded-full bg-white/10" />
                    <span aria-hidden className="bl-float-slow absolute -bottom-32 -left-20 size-80 rounded-full bg-black/10" />

                    <div className="bl-rise relative z-10 flex items-center gap-2.5">
                        <span className="rounded-[14px] bg-white p-1"><LogoMark size={36} /></span>
                        <Wordmark dark className="text-lg [&>span]:text-[#c9f2d9]" />
                    </div>

                    <div className="relative z-10">
                        <RouteArt />
                        <h2 className="bl-rise mt-4 text-[26px] leading-snug font-semibold" style={{ '--d': '500ms' }}>ส่งของถึงทุกสาขา<br />ตรงเวลา ไม่ขาดสต็อก</h2>
                        <ul className="mt-5 space-y-3.5">
                            {FEATURES.map(([Icon, title, sub], i) => (
                                <li key={title} className="bl-rise flex gap-3" style={{ '--d': `${700 + i * 120}ms` }}>
                                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15"><Icon size={18} /></span>
                                    <span>
                                        <span className="block text-sm font-semibold">{title}</span>
                                        <span className="block text-xs text-white/75">{sub}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>

                {/* ฟอร์ม */}
                {/* key={shake}: รหัสผิด → เล่นสั่นใหม่ทุกครั้ง */}
                <form key={shake} onSubmit={submit} className={`flex flex-col justify-center p-7 sm:p-10 ${shake ? 'bl-shake' : ''}`}>
                    <div className="bl-rise mb-8 flex items-center gap-2.5 md:hidden">
                        <LogoMark size={40} />
                        <Wordmark className="text-lg" />
                    </div>

                    <div className={shake ? '' : 'bl-rise'} style={{ '--d': '150ms' }}>
                        <h1 className="text-[28px] leading-tight font-semibold">เข้าสู่ระบบ</h1>
                        <p className="mt-1 mb-7 text-sm text-muted">ระบบเติมสินค้าและจัดส่งระหว่างสาขา</p>
                    </div>

                    <div className={`flex flex-col gap-4 ${shake ? '' : 'bl-rise'}`} style={{ '--d': '280ms' }}>
                        <Field icon={Mail} label="อีเมล" type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                        <Field
                            icon={Lock}
                            label="รหัสผ่าน"
                            type={show ? 'text' : 'password'}
                            autoComplete="current-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            end={
                                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} className="grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-soft hover:text-ink">
                                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                                </button>
                            }
                        />
                    </div>

                    <div className="mt-5"><ErrorBox>{error}</ErrorBox></div>
                    <Button type="submit" size="lg" loading={loading} className={`mt-2 w-full ${shake ? '' : 'bl-rise'}`} style={{ '--d': '400ms' }}>เข้าสู่ระบบ</Button>

                    <p className={`mt-6 text-center text-xs text-muted ${shake ? '' : 'bl-rise'}`} style={{ '--d': '480ms' }}>ยังไม่มีบัญชีหรือลืมรหัสผ่าน · ติดต่อฝ่ายคลังกลาง</p>
                </form>
            </div>
        </div>
    )
}
