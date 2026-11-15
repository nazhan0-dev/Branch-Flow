// โหลดค่าจาก .env (Node 20.12+)
try { process.loadEnvFile(require('path').join(__dirname, '.env')) } catch { console.warn('ไม่พบไฟล์ .env ใช้ค่าเริ่มต้น') }
if (!process.env.SECRET) {
    console.error('ต้องตั้ง SECRET ใน .env (ข้อความสุ่มยาว ๆ สำหรับเซ็น JWT)')
    process.exit(1)
}
try {
    require('./middlewares/auth').cookieOptions()
} catch (err) {
    console.error(err.message)
    process.exit(1)
}

const http = require('http')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const cookieParser = require('cookie-parser')
const cookie = require('cookie')
const { Server } = require('socket.io')
const { COOKIE, loadUser } = require('./middlewares/auth')
const { setIO, roomsFor } = require('./services/realtime')
const { startJobs } = require('./jobs')

const PORT = process.env.PORT || 8000
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean)
const isAllowedOrigin = (origin) => allowedOrigins.includes(origin)

const app = express()
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(cors({ origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)), credentials: true }))

// กัน CSRF: request ที่แก้ไขข้อมูลจากเบราว์เซอร์ต้องมาจากหน้าเว็บที่อนุญาตเท่านั้น
app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.headers.origin
    if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ message: 'Origin not allowed' })
    next()
})

app.get('/api/health', (req, res) => res.json({ ok: true }))
for (const name of ['auth', 'branches', 'branchAdmin', 'requests', 'trips', 'warehouse', 'dashboard', 'fleet']) {
    app.use('/api', require(`./routes/${name}`))
}
app.use('/api', (req, res) => res.status(404).json({ message: 'ไม่พบ API นี้' }))

// error กลาง: error ที่ตั้งใจ (HttpError) ส่งข้อความกลับ ส่วน error อื่นซ่อนรายละเอียด
app.use((err, req, res, next) => {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ message: status >= 500 ? 'Server Error' : err.message, ...(err.details ? { details: err.details } : {}) })
})

// Socket.io ใช้ cookie เดียวกับ API แล้วเข้าห้องตามสิทธิ์อัตโนมัติ
const RECHECK_MS = 5 * 60 * 1000
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } })
io.use(async (socket, next) => {
    const token = cookie.parse(socket.handshake.headers.cookie || '')[COOKIE]
    const user = await loadUser(token)
    if (!user) return next(new Error('unauthorized'))
    socket.data.user = user
    socket.data.token = token
    next()
})
io.on('connection', (socket) => {
    for (const room of roomsFor(socket.data.user)) socket.join(room)
    // ตรวจสิทธิ์ซ้ำเป็นระยะ: token หมดอายุ, บัญชีถูกระงับ หรือเปลี่ยนบทบาท/สาขา → ตัดการเชื่อมต่อ
    const timer = setInterval(async () => {
        const now = await loadUser(socket.data.token).catch(() => null)
        const before = socket.data.user
        if (!now || now.role !== before.role || now.branchId !== before.branchId) socket.disconnect(true)
    }, RECHECK_MS)
    socket.on('disconnect', () => clearInterval(timer))
})
setIO(io)

if (require.main === module) {
    // ปรับโครงสร้างฐานข้อมูลให้ทันโค้ดก่อนเปิดรับ request (ข้อมูลเดิมไม่หาย)
    require('./services/migrate')
        .migrate()
        .catch((err) => console.error('[migrate] ไม่สำเร็จ:', err.message))
        .finally(() => {
            server.listen(PORT, () => console.log(`API + Socket.io running on http://localhost:${PORT}`))
            startJobs()
        })
}

module.exports = { app, server }
