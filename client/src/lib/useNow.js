import { useEffect, useState } from 'react'

// ให้หน้าที่แสดงเวลา/นับถอยหลัง ("อีก 12 นาที") วาดใหม่เองทุกช่วงเวลา ไม่ต้องรีเฟรชหน้า
// ตั้งรอบให้ตรงต้นนาที (ค่าเริ่มต้น 30 วินาที → เปลี่ยนตอน :00 และ :30)
export const useNow = (every = 30000) => {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        let t
        const tick = () => {
            setNow(Date.now())
            t = setTimeout(tick, every - (Date.now() % every))
        }
        t = setTimeout(tick, every - (Date.now() % every))
        // กลับมาที่แท็บหลังพักไว้นาน (เบราว์เซอร์หน่วง timer) → อัปเดตทันที
        const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now())
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            clearTimeout(t)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [every])
    return now
}
