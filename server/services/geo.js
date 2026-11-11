// ระยะทางเส้นตรงบนผิวโลก (กม.) ใช้ประมาณเวลาถึงแบบง่าย
// ตอนแสดงเส้นทางจริงบนแผนที่ หน้าเว็บจะขอจาก OSRM อีกที
const haversineKm = (a, b) => {
    const R = 6371
    const rad = (d) => (d * Math.PI) / 180
    const dLat = rad(b.lat - a.lat)
    const dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
}

const ROAD_FACTOR = 1.35 // ถนนจริงยาวกว่าเส้นตรงประมาณ 35%
const AVG_KMH = Number(process.env.AVG_SPEED_KMH || 30) // ความเร็วเฉลี่ยในเมือง
const UNLOAD_MIN = 15 // เวลาลงของต่อจุด

// คืนเวลาถึงโดยประมาณของแต่ละจุด เริ่มจากจุดออก (คลัง) ตามลำดับ
const estimateEtas = (start, stops, startAt = new Date()) => {
    let t = startAt.getTime()
    let prev = start
    return stops.map((s) => {
        const km = haversineKm(prev, s) * ROAD_FACTOR
        t += (km / AVG_KMH) * 3600e3
        const eta = new Date(t)
        t += UNLOAD_MIN * 60e3
        prev = s
        return { km: Math.round(km * 10) / 10, eta }
    })
}

module.exports = { haversineKm, estimateEtas }
