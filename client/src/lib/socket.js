import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '../api/client'

// เชื่อมต่อครั้งเดียวหลังล็อกอิน server ใช้ cookie เดียวกันจัดห้องตามสิทธิ์ให้เอง
let socket = null

export const connectSocket = () => {
    if (!socket) socket = io(API_URL, { withCredentials: true })
    return socket
}

export const disconnectSocket = () => {
    socket?.disconnect()
    socket = null
}

// ฟัง event แบบ real-time ภายใน component
export const useSocket = (event, handler) => {
    useEffect(() => {
        const s = connectSocket()
        s.on(event, handler)
        return () => s.off(event, handler)
    }, [event, handler])
}
