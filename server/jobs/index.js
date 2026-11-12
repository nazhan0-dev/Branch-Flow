const { submitDueDrafts, scanAllBranches } = require('../services/replenish')
const { ensureSummaries } = require('../services/summary')

// งานเบื้องหลัง (ไม่ต้องติดตั้ง cron เพิ่ม ใช้ setInterval ของ Node)
//  - ทุก 1 นาที: ส่งร่างคำขอที่เลยเวลายืนยันเข้าคลังให้เอง
//  - ทุก 15 นาที: สแกนหาสินค้าที่ใกล้หมดแต่ยังไม่มีคำขอ (ตัวสำรอง กรณีหลุดจากจุดตัดสต็อก)
//  - ทุก 10 นาที: สร้างสรุปผลประจำวัน/สัปดาห์ให้ผู้บริหาร
const safe = (name, fn) => async () => {
    try {
        const n = await fn()
        if (n) console.log(`[job] ${name}: ${n}`)
    } catch (err) {
        console.error(`[job] ${name} failed`, err.message)
    }
}

const startJobs = () => {
    setInterval(safe('submit due drafts', submitDueDrafts), 60 * 1000)
    setInterval(safe('scan low stock', scanAllBranches), 15 * 60 * 1000)
    safe('scan low stock', scanAllBranches)()
    // สรุปผลของผู้บริหาร: เช็กทุก 10 นาที หลังเที่ยงคืนจะได้สรุปของเมื่อวาน (และสรุปสัปดาห์ทุกวันจันทร์)
    setInterval(safe('executive summaries', () => ensureSummaries(true)), 10 * 60 * 1000)
}

module.exports = { startJobs }
