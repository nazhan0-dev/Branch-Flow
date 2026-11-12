// โลโก้ BranchFlow: รถออกจากคลัง (จุดดำ) ส่งจุดแรก แล้วแยกไปอีก 2 สาขา
export const LogoMark = ({ size = 36, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label="BranchFlow">
        <rect width="64" height="64" rx="16" fill="#22a45d" />
        <g fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
            <path d="M14 48C14 34 28 40 30 31S42 16 48 16" />
            <path d="M30 31C36 31 40 43 49 43" />
        </g>
        <circle cx="14" cy="48" r="5.5" fill="#141614" />
        <circle cx="30" cy="31" r="4.5" fill="#fff" />
        <circle cx="48" cy="16" r="6" fill="#fff" />
        <circle cx="48" cy="16" r="2.6" fill="#22a45d" />
        <circle cx="49" cy="43" r="6" fill="#fff" />
        <circle cx="49" cy="43" r="2.6" fill="#22a45d" />
    </svg>
)

// ชื่อแบรนด์: Branch สีเข้ม + Flow สีเขียว (dark = ใช้บนพื้นดำ)
export const Wordmark = ({ className = '', dark }) => (
    <span className={`font-semibold tracking-tight ${dark ? 'text-white' : 'text-ink'} ${className}`}>
        Branch<span className="text-brand">Flow</span>
    </span>
)
