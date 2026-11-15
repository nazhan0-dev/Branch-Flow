const TZ = { timeZone: 'Asia/Bangkok' }

export const time = (d) => (d ? new Date(d).toLocaleTimeString('th-TH', { ...TZ, hour: '2-digit', minute: '2-digit' }) : '–')
export const date = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { ...TZ, day: 'numeric', month: 'short' }) : '–')
export const dateTime = (d) => (d ? `${date(d)} ${time(d)}` : '–')
export const longDate = (d = new Date()) => new Date(d).toLocaleDateString('th-TH', { ...TZ, weekday: 'short', day: 'numeric', month: 'short' })
export const minutesUntil = (d) => Math.round((new Date(d).getTime() - Date.now()) / 60000)
export const isToday = (d) => date(d) === date(new Date())
export const num = (n) => Number(n || 0).toLocaleString('th-TH')
export const baht = (n) => {
    const v = Number(n || 0)
    if (v >= 1e6) return `฿${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `฿${(v / 1e3).toFixed(1)}K`
    return `฿${num(Math.round(v))}`
}
// น้ำหนักจากค่าตัน: ต่ำกว่า 1 ตันแสดงเป็นกิโลกรัม
export const weight = (t) => (Number(t || 0) < 1 ? `${Math.round(Number(t || 0) * 1000)} กก.` : `${Number(t).toFixed(1)} ตัน`)
// "1 ชม. 42 นาที" สำหรับนับถอยหลัง
export const countdown = (min) => (min >= 60 ? `${Math.floor(min / 60)} ชม. ${min % 60} นาที` : `${Math.max(min, 0)} นาที`)

// ป้ายสถานะ: [ข้อความ, สี]
export const REQUEST_STATUS = {
    draft: ['ร่าง · รอยืนยัน', 'warn'],
    pending: ['รออนุมัติ', 'warn'],
    approved: ['อนุมัติแล้ว · รอจัดรถ', 'neutral'],
    in_transit: ['กำลังจัดส่ง', 'brand'],
    received: ['รับแล้ว', 'neutral'],
    rejected: ['ถูกปฏิเสธ', 'danger'],
    cancelled: ['ยกเลิกแล้ว', 'neutral'],
}
export const SOURCE = { auto: 'ระบบร่าง', branch: 'สาขาสั่งเอง', hq: 'คลังเสนอ' }
export const TRIP_STATUS = {
    assigned: ['รอรับงาน', 'warn'],
    accepted: ['รับงานแล้ว', 'neutral'],
    on_route: ['กำลังส่ง', 'brand'],
    completed: ['ส่งครบ', 'neutral'],
    cancelled: ['ยกเลิก', 'danger'],
}
export const STOCK_STATUS = { out: ['หมด', 'danger'], low: ['ใกล้หมด', 'warn'], ok: ['ปกติ', 'brand'] }
