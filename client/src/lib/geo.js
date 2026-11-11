// สูตรเดียวกับฝั่ง server (services/geo.js) ใช้ประมาณระยะทางและเวลาถึงบนหน้าเว็บ
export const haversineKm = (a, b) => {
    const R = 6371
    const rad = (d) => (d * Math.PI) / 180
    const dLat = rad(b.lat - a.lat)
    const dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
}

export const ROAD_FACTOR = 1.35
export const AVG_KMH = 30
export const UNLOAD_MIN = 15

const pt = (p) => ({ lat: Number(p.lat), lng: Number(p.lng) })
export const roadKm = (a, b) => haversineKm(pt(a), pt(b)) * ROAD_FACTOR

// เวลาถึงของแต่ละจุดตามลำดับ เริ่มจาก start
export const estimateEtas = (start, stops, startAt = new Date()) => {
    let t = startAt.getTime()
    let prev = start
    let total = 0
    const list = stops.map((s) => {
        const km = roadKm(prev, s)
        total += km
        t += (km / AVG_KMH) * 3600e3
        const eta = new Date(t)
        t += UNLOAD_MIN * 60e3
        prev = s
        return { km, eta }
    })
    return { list, totalKm: total, minutes: Math.round((t - startAt.getTime()) / 60000) }
}

// จัดลำดับแบบ "ไปจุดที่ใกล้ที่สุดก่อน" (nearest neighbour) — เร็วและอธิบายง่าย
export const nearestOrder = (start, stops) => {
    const left = [...stops]
    const out = []
    let cur = start
    while (left.length) {
        let best = 0
        for (let i = 1; i < left.length; i++) if (roadKm(cur, left[i]) < roadKm(cur, left[best])) best = i
        cur = left.splice(best, 1)[0]
        out.push(cur)
    }
    return out
}

// --- เดินตามเส้นทางถนน (ใช้ในโหมดจำลองการวิ่ง) ---
// line = [[lat, lng], ...] จาก OSRM

const ll = ([lat, lng]) => ({ lat, lng })

// index ของจุดบนเส้นที่ใกล้ p ที่สุด ค้นตั้งแต่ from เป็นต้นไป (กันไปจับเส้นช่วงที่ผ่านมาแล้ว)
export const nearestIndex = (line, p, from = 0) => {
    let best = from
    let bestKm = Infinity
    for (let i = from; i < line.length; i++) {
        const km = haversineKm(ll(line[i]), p)
        if (km < bestKm) {
            bestKm = km
            best = i
        }
    }
    return best
}

// เดินจาก cur = { idx, point } ไปตามเส้นอีก stepKm แต่ไม่เกินจุด targetIdx
export const walkAlong = (line, cur, stepKm, targetIdx) => {
    let { idx, point } = cur
    let left = stepKm
    while (left > 0 && idx < targetIdx) {
        const nextPt = ll(line[idx + 1])
        const seg = haversineKm(point, nextPt)
        if (seg <= left) {
            point = nextPt
            idx++
            left -= seg
        } else {
            const r = left / seg
            point = { lat: point.lat + (nextPt.lat - point.lat) * r, lng: point.lng + (nextPt.lng - point.lng) * r }
            left = 0
        }
    }
    return { idx, point }
}

export const fmtKm =(km) => `${km < 10 ? km.toFixed(1) : Math.round(km)} กม.`
export const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)} ชม. ${min % 60} น.` : `${min} นาที`)
