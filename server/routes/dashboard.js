const router = require('express').Router()
const { query, one } = require('../config/db')
const { handle } = require('../config/errors')
const { authCheck, requireRole, assertBranchAccess } = require('../middlewares/auth')
const { ensureSummaries } = require('../services/summary')

// แจ้งเตือนของผู้ใช้: ส่งถึงตัวเอง หรือส่งถึงทั้งบทบาท (สาขาเห็นเฉพาะของสาขาตัวเอง)
const notifWhere = (u) => {
    if (u.role === 'branch') return ['(user_id = ? OR (role = ? AND branch_id = ?))', [u.id, 'branch', u.branchId]]
    // ผู้บริหาร: เฉพาะสรุปผล (role = executive) ไม่เห็นแจ้งเตือนงานรายเคสของคลัง
    return ['(user_id = ? OR (role = ? AND branch_id IS NULL))', [u.id, u.role]]
}
// แสดงในหน้าต่างแจ้งเตือนย้อนหลังกี่วัน (เก่ากว่านี้ไม่แสดง แต่ยังอยู่ในฐานข้อมูล)
const SHOW_DAYS = { executive: 30 }
const DEFAULT_SHOW_DAYS = 7
const recent = (u) => `created_at >= UTC_TIMESTAMP() - INTERVAL ${SHOW_DAYS[u.role] || DEFAULT_SHOW_DAYS} DAY`

router.get('/notifications', authCheck, handle(async (req, res) => {
    // สรุปของวัน/สัปดาห์ที่จบไปแล้วแต่ยังไม่ได้สร้าง (เช่นเซิร์ฟเวอร์ปิดอยู่ตอนเที่ยงคืน) สร้างตอนเปิดดู
    if (req.user.role === 'executive') await ensureSummaries()
    const [w, p] = notifWhere(req.user)
    const items = await query(`SELECT id, type, message, link, read_at AS readAt, created_at AS createdAt FROM notification WHERE ${w} AND ${recent(req.user)} ORDER BY created_at DESC, id DESC LIMIT 50`, p)
    const unread = await one(`SELECT COUNT(*) AS n FROM notification WHERE ${w} AND ${recent(req.user)} AND read_at IS NULL`, p)
    res.json({ unread: unread.n, items })
}))

router.post('/notifications/read-all', authCheck, handle(async (req, res) => {
    const [w, p] = notifWhere(req.user)
    await query(`UPDATE notification SET read_at = UTC_TIMESTAMP(3) WHERE ${w} AND read_at IS NULL`, p)
    res.json({ ok: true })
}))

// อ่านทีละรายการ (เช่นกดกล่องแจ้งเตือนที่เด้งขึ้นมา) — ทำได้เฉพาะรายการที่ผู้ใช้คนนี้มีสิทธิ์เห็น
router.post('/notifications/:id/read', authCheck, handle(async (req, res) => {
    const [w, p] = notifWhere(req.user)
    const r = await query(`UPDATE notification SET read_at = UTC_TIMESTAMP(3) WHERE id = ? AND ${w} AND read_at IS NULL`, [Number(req.params.id), ...p])
    res.json({ ok: true, updated: r.affectedRows })
}))

// ภาพรวมทุกสาขา (Admin / ผู้บริหาร) เทียบกับช่วงเวลาก่อนหน้าที่ยาวเท่ากัน
const periodStats = (from, to) =>
    one(
        `SELECT
           (SELECT COUNT(*) FROM trip WHERE created_at >= ? AND created_at < ?) AS trips,
           (SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, t.started_at, ts.received_at)) / 60, 1)
              FROM trip_stop ts JOIN trip t ON t.id = ts.trip_id WHERE ts.received_at >= ? AND ts.received_at < ?) AS avgDeliveryHours,
           (SELECT ROUND(100 * AVG(ts.arrived_at <= ts.eta + INTERVAL 15 MINUTE), 1)
              FROM trip_stop ts WHERE ts.arrived_at >= ? AND ts.arrived_at < ? AND ts.eta IS NOT NULL) AS onTimePct,
           (SELECT COALESCE(SUM(ri.qty_received * p.price), 0) FROM request_item ri
              JOIN replenish_request r ON r.id = ri.request_id JOIN product p ON p.id = ri.product_id
              WHERE r.received_at >= ? AND r.received_at < ?) AS valueDelivered`,
        [from, to, from, to, from, to, from, to]
    )

router.get('/dashboard/overview', authCheck, requireRole('admin', 'executive'), handle(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90)
    const now = new Date()
    const from = new Date(now.getTime() - days * 864e5)
    const prevFrom = new Date(from.getTime() - days * 864e5)
    const [cur, prev, live, byStatus, frequentOut, daily, regions, vehicles] = await Promise.all([
        periodStats(from, now),
        periodStats(prevFrom, from),
        one(
            `SELECT (SELECT COUNT(*) FROM trip WHERE status = 'on_route') AS onRoute,
                    (SELECT COUNT(DISTINCT bs.branch_id) FROM branch_stock bs WHERE bs.qty <= 0) AS branchesOut,
                    (SELECT COUNT(*) FROM branch WHERE is_warehouse = 0) AS branchCount,
                    (SELECT COUNT(*) FROM replenish_request WHERE status = 'pending') AS pendingRequests`
        ),
        query("SELECT status, COUNT(*) AS n FROM replenish_request WHERE created_at >= UTC_DATE() GROUP BY status"),
        // สาขาที่ต้องขอด่วนบ่อย (ด่วน = มีสินค้าหมด) ในช่วงที่เลือก
        query(
            `SELECT b.id, b.name, COUNT(*) AS times FROM replenish_request r JOIN branch b ON b.id = r.branch_id
             WHERE r.priority = 'urgent' AND r.created_at >= ? GROUP BY b.id ORDER BY times DESC, b.name LIMIT 5`,
            [from]
        ),
        query(
            `SELECT DATE(CONVERT_TZ(t.created_at, '+00:00', '+07:00')) AS day, COUNT(DISTINCT t.id) AS trips,
                    COUNT(DISTINCT CASE WHEN ts.arrived_at > ts.eta + INTERVAL 15 MINUTE THEN ts.id END) AS late
             FROM trip t LEFT JOIN trip_stop ts ON ts.trip_id = t.id
             WHERE t.created_at >= ? GROUP BY day ORDER BY day`,
            [from]
        ),
        query(
            `SELECT b.region, COUNT(DISTINCT b.id) AS branches, COUNT(DISTINCT ts.trip_id) AS trips,
                    ROUND(100 * AVG(CASE WHEN ts.arrived_at IS NOT NULL AND ts.eta IS NOT NULL THEN ts.arrived_at <= ts.eta + INTERVAL 15 MINUTE END), 1) AS onTimePct
             FROM branch b LEFT JOIN replenish_request r ON r.branch_id = b.id AND r.created_at >= ?
             LEFT JOIN trip_stop ts ON ts.request_id = r.id
             WHERE b.is_warehouse = 0 GROUP BY b.region ORDER BY branches DESC, b.region`,
            [from]
        ),
        query("SELECT status, COUNT(*) AS n FROM vehicle WHERE status <> 'retired' GROUP BY status"),
    ])
    res.json({ days, kpi: { ...cur, ...live }, prev, requestsToday: byStatus, frequentOut, dailyTrips: daily, regions, vehicles })
}))

// ภาพรวมของสาขาเดียว
router.get('/dashboard/branch/:id', authCheck, handle(async (req, res) => {
    const branchId = Number(req.params.id)
    assertBranchAccess(req.user, branchId)
    const [branch, stock, outNames, draft, incoming, recent, onTime] = await Promise.all([
        one('SELECT id, code, name, region FROM branch WHERE id = ?', [branchId]),
        one('SELECT SUM(qty <= 0) AS outItems, SUM(qty > 0 AND qty <= reorder_point) AS lowItems, COUNT(*) AS totalItems FROM branch_stock WHERE branch_id = ?', [branchId]),
        query('SELECT p.name, p.sku FROM branch_stock bs JOIN product p ON p.id = bs.product_id WHERE bs.branch_id = ? AND bs.qty <= 0 ORDER BY p.sku LIMIT 3', [branchId]),
        one(
            `SELECT r.id, r.code, r.priority, r.auto_submit_at AS autoSubmitAt, COUNT(ri.product_id) AS itemCount
             FROM replenish_request r JOIN request_item ri ON ri.request_id = r.id
             WHERE r.branch_id = ? AND r.status = 'draft' GROUP BY r.id ORDER BY r.id DESC LIMIT 1`,
            [branchId]
        ),
        one(
            `SELECT t.id AS tripId, t.code, t.status, ts.eta, ts.status AS stopStatus, r.code AS requestCode, r.id AS requestId,
                    (SELECT COUNT(*) FROM request_item ri WHERE ri.request_id = r.id AND ri.qty_approved > 0) AS itemCount
             FROM trip_stop ts JOIN trip t ON t.id = ts.trip_id JOIN replenish_request r ON r.id = ts.request_id
             WHERE r.branch_id = ? AND ts.status <> 'received' AND t.status IN ('assigned','accepted','on_route')
             ORDER BY ts.eta IS NULL, ts.eta LIMIT 1`,
            [branchId]
        ),
        query(
            `SELECT r.id, r.code, r.source, r.status, r.priority, r.created_at AS createdAt, COUNT(ri.product_id) AS itemCount,
                    SUM(ri.qty_received IS NOT NULL AND ri.qty_received + ri.qty_damaged < ri.qty_approved) AS shortItems
             FROM replenish_request r LEFT JOIN request_item ri ON ri.request_id = r.id
             WHERE r.branch_id = ? GROUP BY r.id ORDER BY r.id DESC LIMIT 4`,
            [branchId]
        ),
        one(
            `SELECT COUNT(*) AS total, SUM(ts.arrived_at <= ts.eta + INTERVAL 15 MINUTE) AS onTime
             FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id
             WHERE r.branch_id = ? AND ts.arrived_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND ts.eta IS NOT NULL`,
            [branchId]
        ),
    ])
    res.json({ branch, stock, outNames, draft, incoming, recent, onTime })
}))

// ===== ยอดขาย (จากบิล POS ที่บันทึกเป็น stock_movement reason = 'sale') =====
// เวลาในฐานข้อมูลเป็น UTC แต่ "วัน" ของสาขานับตามเวลาไทย (UTC+7)
// มูลค่าคิดจากราคาสินค้าปัจจุบัน (ระบบไม่ได้เก็บราคาขายต่อบิล)
const BKK_MS = 7 * 3600e3
const DAY_MS = 864e5
const bkkDayStart = (t = Date.now()) => new Date(Math.floor((t + BKK_MS) / DAY_MS) * DAY_MS - BKK_MS)
const bkkDayKey = (d) => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10)

const salesSum = (branchId, from, to) =>
    one(
        `SELECT COALESCE(SUM(-sm.change * p.price), 0) AS revenue, COALESCE(SUM(-sm.change), 0) AS units
         FROM stock_movement sm JOIN product p ON p.id = sm.product_id
         WHERE sm.branch_id = ? AND sm.reason = 'sale' AND sm.created_at >= ? AND sm.created_at < ?`,
        [branchId, from, to]
    )
const billCount = (branchId, from, to) =>
    one('SELECT COUNT(*) AS n FROM pos_sale WHERE branch_id = ? AND sold_at >= ? AND sold_at < ?', [branchId, from, to]).then((r) => r.n)

// ===== ของเสีย: 2 แหล่ง =====
//  - ในสาขา: stock_movement reason = 'waste' (สาเหตุอยู่ต้น note: หมดอายุ / เสียหาย / อื่น ๆ)
//  - ตอนรับของจากรถ: request_item.qty_damaged (นับตามเวลาที่สาขากดรับของ)
const WASTE_KIND = "CASE WHEN sm.note LIKE 'หมดอายุ%' THEN 'expired' WHEN sm.note LIKE 'เสียหาย%' THEN 'damaged' ELSE 'other' END"
const wasteUnion = (cols) => `
    SELECT ${cols.store} FROM stock_movement sm JOIN product p ON p.id = sm.product_id
    WHERE sm.branch_id = ? AND sm.reason = 'waste' AND sm.created_at >= ? AND sm.created_at < ?
    UNION ALL
    SELECT ${cols.transit} FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id JOIN product p ON p.id = ri.product_id
    WHERE r.branch_id = ? AND r.received_at >= ? AND r.received_at < ? AND ri.qty_damaged > 0`
const wasteParams = (branchId, from, to) => [branchId, from, to, branchId, from, to]

const wasteByKind = (branchId, from, to) =>
    query(
        `SELECT kind, SUM(units) AS units, SUM(value) AS value FROM (${wasteUnion({
            store: `${WASTE_KIND} AS kind, -sm.change AS units, -sm.change * p.price AS value`,
            transit: "'transit' AS kind, ri.qty_damaged AS units, ri.qty_damaged * p.price AS value",
        })}) w GROUP BY kind`,
        wasteParams(branchId, from, to)
    ).then((rows) => {
        const kinds = { expired: { units: 0, value: 0 }, damaged: { units: 0, value: 0 }, transit: { units: 0, value: 0 }, other: { units: 0, value: 0 } }
        for (const r of rows) kinds[r.kind] = { units: Number(r.units), value: Number(r.value) }
        const total = Object.values(kinds).reduce((s, k) => ({ units: s.units + k.units, value: s.value + k.value }), { units: 0, value: 0 })
        return { ...total, byKind: kinds }
    })

router.get('/dashboard/branch/:id/sales', authCheck, handle(async (req, res) => {
    const branchId = Number(req.params.id)
    assertBranchAccess(req.user, branchId)
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7
    const now = new Date()
    const today = bkkDayStart()
    const yesterday = new Date(today.getTime() - DAY_MS)
    const sameTimeYesterday = new Date(now.getTime() - DAY_MS)
    const from = new Date(today.getTime() - (days - 1) * DAY_MS) // รวมวันนี้ = days วัน
    const prevFrom = new Date(from.getTime() - days * DAY_MS)

    const [todaySum, ySum, todayBills, ySameBills, cur, prev, curBills, daily, top, waste, prevWaste, wasteDaily, topWaste, recentWaste] = await Promise.all([
        salesSum(branchId, today, now),
        salesSum(branchId, yesterday, sameTimeYesterday),
        billCount(branchId, today, now),
        billCount(branchId, yesterday, sameTimeYesterday),
        salesSum(branchId, from, now),
        salesSum(branchId, prevFrom, from),
        billCount(branchId, from, now),
        query(
            `SELECT DATE_FORMAT(sm.created_at + INTERVAL 7 HOUR, '%Y-%m-%d') AS day,
                    SUM(-sm.change * p.price) AS revenue, SUM(-sm.change) AS units
             FROM stock_movement sm JOIN product p ON p.id = sm.product_id
             WHERE sm.branch_id = ? AND sm.reason = 'sale' AND sm.created_at >= ?
             GROUP BY day ORDER BY day`,
            [branchId, from]
        ),
        query(
            `SELECT p.id AS productId, p.sku, p.name, p.unit, SUM(-sm.change) AS units, SUM(-sm.change * p.price) AS revenue
             FROM stock_movement sm JOIN product p ON p.id = sm.product_id
             WHERE sm.branch_id = ? AND sm.reason = 'sale' AND sm.created_at >= ?
             GROUP BY p.id ORDER BY revenue DESC, units DESC LIMIT 5`,
            [branchId, from]
        ),
        wasteByKind(branchId, from, now),
        wasteByKind(branchId, prevFrom, from),
        query(
            `SELECT day, SUM(value) AS value FROM (${wasteUnion({
                store: "DATE_FORMAT(sm.created_at + INTERVAL 7 HOUR, '%Y-%m-%d') AS day, -sm.change * p.price AS value",
                transit: "DATE_FORMAT(r.received_at + INTERVAL 7 HOUR, '%Y-%m-%d') AS day, ri.qty_damaged * p.price AS value",
            })}) w GROUP BY day`,
            wasteParams(branchId, from, now)
        ),
        query(
            `SELECT productId, sku, name, unit, SUM(units) AS units, SUM(value) AS value FROM (${wasteUnion({
                store: 'p.id AS productId, p.sku, p.name, p.unit, -sm.change AS units, -sm.change * p.price AS value',
                transit: 'p.id AS productId, p.sku, p.name, p.unit, ri.qty_damaged AS units, ri.qty_damaged * p.price AS value',
            })}) w GROUP BY productId, sku, name, unit ORDER BY value DESC LIMIT 5`,
            wasteParams(branchId, from, now)
        ),
        // รายการล่าสุด (ไม่จำกัดช่วงวัน)
        query(
            `SELECT * FROM (
                SELECT sm.created_at AS at, p.name, p.sku, p.unit, -sm.change AS qty, ${WASTE_KIND} AS kind, sm.note, u.name AS byName, NULL AS requestCode
                FROM stock_movement sm JOIN product p ON p.id = sm.product_id LEFT JOIN user u ON u.id = sm.user_id
                WHERE sm.branch_id = ? AND sm.reason = 'waste'
                UNION ALL
                SELECT r.received_at, p.name, p.sku, p.unit, ri.qty_damaged, 'transit', NULL, NULL, r.code
                FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id JOIN product p ON p.id = ri.product_id
                WHERE r.branch_id = ? AND ri.qty_damaged > 0 AND r.received_at IS NOT NULL
             ) w ORDER BY at DESC LIMIT 6`,
            [branchId, branchId]
        ),
    ])

    // เติมวันที่ไม่มีข้อมูลเป็น 0 ให้กราฟต่อเนื่อง
    const byDay = new Map(daily.map((d) => [d.day, d]))
    const wasteDay = new Map(wasteDaily.map((d) => [d.day, Number(d.value)]))
    const series = []
    for (let i = 0; i < days; i++) {
        const key = bkkDayKey(new Date(from.getTime() + i * DAY_MS))
        const d = byDay.get(key)
        series.push({ day: key, revenue: d ? Number(d.revenue) : 0, units: d ? Number(d.units) : 0, waste: wasteDay.get(key) || 0 })
    }

    res.json({
        days,
        today: { ...todaySum, bills: todayBills },
        yesterdaySameTime: { ...ySum, bills: ySameBills },
        period: { ...cur, bills: curBills },
        prevPeriod: prev,
        daily: series,
        topProducts: top,
        waste: { ...waste, prevValue: prevWaste.value, top: topWaste, recent: recentWaste },
    })
}))

// รายชื่อสาขาพร้อมตัวเลขสรุป ให้ Admin / ผู้บริหารเลือกเข้าไปดู Dashboard ของสาขา
router.get('/dashboard/branches', authCheck, requireRole('admin', 'executive'), handle(async (req, res) => {
    const today = bkkDayStart()
    const week = new Date(today.getTime() - 6 * DAY_MS)
    res.json(await query(
        `SELECT b.id, b.code, b.name, b.region,
                COALESCE(st.outItems, 0) AS outItems, COALESCE(st.lowItems, 0) AS lowItems,
                COALESCE(sa.today, 0) AS salesToday, COALESCE(sa.week, 0) AS sales7d,
                COALESCE(rq.open, 0) AS openRequests, COALESCE(rq.urgent, 0) AS urgentRequests,
                COALESCE(ws.value, 0) + COALESCE(wt.value, 0) AS waste7d
         FROM branch b
         LEFT JOIN (SELECT sm.branch_id, SUM(-sm.change * p.price) AS value FROM stock_movement sm JOIN product p ON p.id = sm.product_id
                    WHERE sm.reason = 'waste' AND sm.created_at >= ? GROUP BY sm.branch_id) ws ON ws.branch_id = b.id
         LEFT JOIN (SELECT r.branch_id, SUM(ri.qty_damaged * p.price) AS value FROM request_item ri
                    JOIN replenish_request r ON r.id = ri.request_id JOIN product p ON p.id = ri.product_id
                    WHERE ri.qty_damaged > 0 AND r.received_at >= ? GROUP BY r.branch_id) wt ON wt.branch_id = b.id
         LEFT JOIN (SELECT branch_id, SUM(qty <= 0) AS outItems, SUM(qty > 0 AND qty <= reorder_point) AS lowItems
                    FROM branch_stock GROUP BY branch_id) st ON st.branch_id = b.id
         LEFT JOIN (SELECT sm.branch_id,
                           SUM(CASE WHEN sm.created_at >= ? THEN -sm.change * p.price ELSE 0 END) AS today,
                           SUM(-sm.change * p.price) AS week
                    FROM stock_movement sm JOIN product p ON p.id = sm.product_id
                    WHERE sm.reason = 'sale' AND sm.created_at >= ? GROUP BY sm.branch_id) sa ON sa.branch_id = b.id
         LEFT JOIN (SELECT branch_id, COUNT(*) AS open, SUM(priority = 'urgent') AS urgent
                    FROM replenish_request WHERE status IN ('draft','pending','approved','in_transit') GROUP BY branch_id) rq ON rq.branch_id = b.id
         WHERE b.is_warehouse = 0
         ORDER BY outItems DESC, lowItems DESC, b.name`,
        [week, week, today, week]
    ))
}))

module.exports = router
