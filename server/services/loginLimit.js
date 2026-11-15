// จำกัดการล็อกอินผิด กันคนสุ่มเดารหัสผ่าน (เก็บในหน่วยความจำ: เหมาะกับ server ตัวเดียว ถ้ามีหลายตัวให้ย้ายไปเก็บที่ Redis)
//  - อีเมลเดียวกันจาก IP เดียวกัน ผิดได้ 5 ครั้ง / 15 นาที
//  - IP เดียวกัน (ทุกอีเมลรวมกัน) ผิดได้ 30 ครั้ง / 15 นาที กันไล่สุ่มหลายอีเมล
// ล็อกอินสำเร็จแล้วล้างตัวนับของอีเมลนั้น
const WINDOW_MS = 15 * 60 * 1000
const LIMITS = { email: 5, ip: 30 }
const hits = new Map() // key → { n, resetAt }

const keys = (ip, email) => [[`e|${ip}|${email}`, LIMITS.email], [`i|${ip}`, LIMITS.ip]]

const prune = (now) => {
    if (hits.size < 5000) return
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
}

// คืนจำนวนวินาทีที่ต้องรอ ถ้าเกินโควตาแล้ว (0 = ล็อกอินได้)
const retryAfter = (ip, email) => {
    const now = Date.now()
    let wait = 0
    for (const [k, max] of keys(ip, email)) {
        const h = hits.get(k)
        if (h && h.resetAt > now && h.n >= max) wait = Math.max(wait, Math.ceil((h.resetAt - now) / 1000))
    }
    return wait
}

const recordFailure = (ip, email) => {
    const now = Date.now()
    prune(now)
    for (const [k] of keys(ip, email)) {
        const h = hits.get(k)
        if (!h || h.resetAt <= now) hits.set(k, { n: 1, resetAt: now + WINDOW_MS })
        else h.n++
    }
}

const recordSuccess = (ip, email) => hits.delete(`e|${ip}|${email}`)

module.exports = { retryAfter, recordFailure, recordSuccess, LIMITS }
