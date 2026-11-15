const router = require('express').Router()
const bcrypt = require('bcryptjs')
const { one } = require('../config/db')
const { fail, handle } = require('../config/errors')
const { COOKIE, cookieOptions, sign, authCheck } = require('../middlewares/auth')
const limit = require('../services/loginLimit')

// hash หลอกไว้เทียบเมื่อไม่พบอีเมล ให้เวลาตอบเท่ากับกรณีรหัสผิด (กันเดาว่าอีเมลไหนมีบัญชีจากความเร็วในการตอบ)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

router.post('/auth/login', handle(async (req, res) => {
    const { email, password } = req.body || {}
    if (!email || !password) fail(400, 'กรอกอีเมลและรหัสผ่าน')
    const addr = String(email).trim().toLowerCase()
    const wait = limit.retryAfter(req.ip, addr)
    if (wait) {
        res.set('Retry-After', String(wait))
        fail(429, `ล็อกอินผิดหลายครั้งเกินไป ลองใหม่ในอีก ${Math.ceil(wait / 60)} นาที`)
    }
    const user = await one(
        `SELECT u.* FROM user u LEFT JOIN branch b ON b.id = u.branch_id
         WHERE u.email = ? AND u.enabled = 1 AND (u.branch_id IS NULL OR b.active = 1)`,
        [addr]
    )
    // ตอบข้อความเดียวกันทั้งกรณีไม่มีอีเมลและรหัสผิด ไม่บอกใบ้ว่าอีเมลไหนมีในระบบ
    const match = await bcrypt.compare(String(password), user ? user.password : DUMMY_HASH)
    if (!user || !match) {
        limit.recordFailure(req.ip, addr)
        fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    }
    limit.recordSuccess(req.ip, addr)

    res.cookie(COOKIE, sign(user), cookieOptions())
    const branch = user.branch_id ? await one('SELECT id, code, name FROM branch WHERE id = ?', [user.branch_id]) : null
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branch_id, branch } })
}))

router.post('/auth/logout', (req, res) => {
    const { maxAge, ...opts } = cookieOptions()
    res.clearCookie(COOKIE, opts)
    res.json({ ok: true })
})

router.get('/auth/me', authCheck, handle(async (req, res) => {
    const branch = req.user.branchId ? await one('SELECT id, code, name FROM branch WHERE id = ?', [req.user.branchId]) : null
    res.json({ user: { ...req.user, branch } })
}))

module.exports = router
