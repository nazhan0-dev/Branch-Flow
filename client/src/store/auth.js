import { create } from 'zustand'
import api from '../api/client'

// cookie ล็อกอินใช้ร่วมกันทุกแท็บ: แท็บหนึ่งล็อกอิน/ออก จะกระทบแท็บอื่นด้วย
// แจ้งแท็บอื่นผ่าน localStorage (event "storage" เด้งเฉพาะแท็บอื่น ไม่เด้งแท็บที่เขียน)
export const AUTH_SIGNAL = 'bl:auth'
const signalOtherTabs = () => {
    try {
        localStorage.setItem(AUTH_SIGNAL, String(Date.now()))
    } catch {
        // ไม่มี localStorage (เช่นโหมดส่วนตัวบางเบราว์เซอร์) แท็บอื่นจะรู้ตอนกลับมาที่แท็บแทน
    }
}

// หน้าเว็บไม่เก็บ token เอง (อยู่ใน httpOnly cookie) เก็บแค่ข้อมูลผู้ใช้ไว้แสดงผล
export const useAuth = create((set, get) => ({
    user: null,
    ready: false,
    async load() {
        try {
            const { data } = await api.get('/auth/me')
            set({ user: data.user, ready: true })
        } catch {
            set({ user: null, ready: true })
        }
    },
    async login(email, password) {
        const { data } = await api.post('/auth/login', { email, password })
        set({ user: data.user })
        signalOtherTabs()
        return data.user
    },
    async logout() {
        await api.post('/auth/logout').catch(() => {})
        set({ user: null })
        signalOtherTabs()
    },
    /**
     * เทียบผู้ใช้ในแท็บนี้กับเจ้าของ cookie ตอนนี้
     * คืนค่า 'same' | 'changed' (แท็บอื่นล็อกอินเป็นคนอื่น) | 'gone' (ออกจากระบบแล้ว)
     * error อื่น (เน็ตหลุด, server ล่ม) ถือว่า 'same' ไม่ไล่ผู้ใช้ออก
     */
    async check() {
        const current = get().user
        try {
            const { data } = await api.get('/auth/me')
            if (current && data.user.id === current.id && data.user.role === current.role) return 'same'
            set({ user: data.user })
            return 'changed'
        } catch (err) {
            if (err.response?.status !== 401) return 'same'
            if (!current) return 'same'
            set({ user: null })
            return 'gone'
        }
    },
    clear() {
        set({ user: null })
    },
}))

export const HOME = { branch: '/branch', admin: '/admin', driver: '/driver', executive: '/exec' }
