import axios from 'axios'

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')

// withCredentials: ส่ง cookie (JWT httpOnly) ไปกับทุก request
const api = axios.create({ baseURL: `${API_URL}/api`, withCredentials: true })

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => {
    onUnauthorized = fn
}

api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401 && !err.config.url.includes('/auth/')) onUnauthorized()
        return Promise.reject(err)
    }
)

// ข้อความ error ที่อ่านได้จาก response
export const errMsg = (err) => err.response?.data?.message || err.message || 'เกิดข้อผิดพลาด'

export default api
