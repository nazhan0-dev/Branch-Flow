const router = require('express').Router()
const bcrypt = require('bcryptjs')
const { one } = require('../config/db')
const { fail, handle } = require('../config/errors')
const { COOKIE, cookieOptions, sign, authCheck } = require('../middlewares/auth')

router.post('/auth/login', handle(async (req, res) => {
    const { email, password } = req.body || {}
    if (!email || !password) fail(400, 'กรอกอีเมลและรหัสผ่าน')
    const user = await one(
        `SELECT u.* FROM user u LEFT JOIN branch b ON b.id = u.branch_id
         WHERE u.email = ? AND u.enabled = 1 AND (u.branch_id IS NULL OR b.active = 1)`,
        [String(email).trim().toLowerCase()]
    )
    // ตอบข้อความเดียวกันทั้งกรณีไม่มีอีเมลและรหัสผิด ไม่บอกใบ้ว่าอีเมลไหนมีในระบบ
    if (!user || !(await bcrypt.compare(String(password), user.password))) fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')

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
