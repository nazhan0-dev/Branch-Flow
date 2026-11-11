import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { setUnauthorizedHandler } from './api/client'
import { disconnectSocket } from './lib/socket'
import { AUTH_SIGNAL, HOME, useAuth } from './store/auth'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Login from './pages/Login'
import BranchDashboard from './pages/branch/Dashboard'
import BranchStock from './pages/branch/Stock'
import BranchRequests from './pages/branch/Requests'
import EditRequest from './pages/branch/RequestDetail'
import NewRequest from './pages/branch/NewRequest'
import Receive from './pages/branch/Receive'
import Track from './pages/branch/Track'
import AdminRequests from './pages/admin/Requests'
import Warehouse from './pages/admin/Warehouse'
import Planner from './pages/admin/Planner'
import LiveMap from './pages/admin/LiveMap'
import DriverJobs, { DriverHistory, DriverMap, DriverProfile } from './pages/driver/Jobs'
import DriverTrip from './pages/driver/Trip'
import Overview from './pages/exec/Overview'
import Branches from './pages/shared/Branches'

// เข้าได้เฉพาะบทบาทที่กำหนด ไม่ใช่ก็พากลับหน้าแรกของบทบาทตัวเอง
const Guard = ({ roles, children }) => {
    const user = useAuth((s) => s.user)
    if (!user) return <Navigate to="/login" replace />
    if (!roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />
    return <Layout>{children}</Layout>
}

// ลิงก์เก่า /branch/requests/:id → ประวัติคำขอที่เลือกคำขอนั้นไว้
const RequestRedirect = () => <Navigate to={`/branch/requests?id=${useParams().id}`} replace />

const B = ['branch']
const A = ['admin']
const D = ['driver']
const E = ['executive']

export default function App() {
    const { user, ready, load, clear } = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        load()
        setUnauthorizedHandler(() => {
            disconnectSocket()
            clear()
            navigate('/login', { replace: true })
        })
    }, [load, clear, navigate])

    // แท็บอื่นล็อกอินเป็นคนอื่นหรือออกจากระบบ → cookie เปลี่ยน แท็บนี้ต้องตามให้ทัน
    // ไม่อย่างนั้นหน้าจอยังเป็นผู้ใช้เดิม แต่ทุก request ไปในนามคนใหม่
    useEffect(() => {
        if (!ready) return
        let busy = false
        const sync = async () => {
            if (busy) return
            busy = true
            const result = await useAuth.getState().check()
            busy = false
            if (result === 'same') return
            // โหลดหน้าใหม่ทั้งหมด: ล้างข้อมูลเก่าในหน้า และให้ socket เข้าห้องตามสิทธิ์ใหม่
            disconnectSocket()
            const next = useAuth.getState().user
            window.location.replace(next ? HOME[next.role] : '/login')
        }
        const onStorage = (e) => e.key === AUTH_SIGNAL && sync()
        const onVisible = () => document.visibilityState === 'visible' && sync()
        window.addEventListener('storage', onStorage)
        window.addEventListener('focus', sync)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            window.removeEventListener('storage', onStorage)
            window.removeEventListener('focus', sync)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [ready])

    if (!ready) return <Loading />

    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />

            <Route path="/branch" element={<Guard roles={B}><BranchDashboard /></Guard>} />
            <Route path="/branch/stock" element={<Guard roles={B}><BranchStock /></Guard>} />
            <Route path="/branch/stock-count" element={<Navigate to="/branch/stock" replace />} />
            <Route path="/branch/order" element={<Guard roles={B}><NewRequest /></Guard>} />
            <Route path="/branch/requests" element={<Guard roles={B}><BranchRequests /></Guard>} />
            <Route path="/branch/requests/new" element={<Navigate to="/branch/order" replace />} />
            <Route path="/branch/requests/:id" element={<RequestRedirect />} />
            <Route path="/branch/requests/:id/edit" element={<Guard roles={B}><EditRequest /></Guard>} />
            <Route path="/branch/receive/:id" element={<Guard roles={B}><Receive /></Guard>} />
            <Route path="/branch/track" element={<Guard roles={B}><Track /></Guard>} />
            <Route path="/branch/track/:id" element={<Guard roles={B}><Track /></Guard>} />

            <Route path="/admin" element={<Navigate to="/admin/trips" replace />} />
            <Route path="/admin/requests" element={<Guard roles={A}><AdminRequests /></Guard>} />
            <Route path="/admin/requests/:id" element={<Guard roles={A}><AdminRequests /></Guard>} />
            <Route path="/admin/warehouse" element={<Guard roles={A}><Warehouse /></Guard>} />
            <Route path="/admin/planner" element={<Guard roles={A}><Planner /></Guard>} />
            <Route path="/admin/trips" element={<Guard roles={A}><LiveMap /></Guard>} />
            <Route path="/admin/trips/:id" element={<Guard roles={A}><LiveMap /></Guard>} />
            <Route path="/admin/overview" element={<Guard roles={A}><Overview /></Guard>} />
            <Route path="/admin/branches" element={<Guard roles={A}><Branches viewer="admin" /></Guard>} />
            <Route path="/admin/branches/:id" element={<Guard roles={A}><Branches viewer="admin" /></Guard>} />

            <Route path="/driver" element={<Guard roles={D}><DriverJobs /></Guard>} />
            <Route path="/driver/trips/:id" element={<Guard roles={D}><DriverTrip /></Guard>} />
            <Route path="/driver/map" element={<Guard roles={D}><DriverMap /></Guard>} />
            <Route path="/driver/history" element={<Guard roles={D}><DriverHistory /></Guard>} />
            <Route path="/driver/profile" element={<Guard roles={D}><DriverProfile /></Guard>} />

            <Route path="/exec" element={<Guard roles={E}><Overview /></Guard>} />
            <Route path="/exec/trips" element={<Guard roles={E}><LiveMap readOnly /></Guard>} />
            <Route path="/exec/trips/:id" element={<Guard roles={E}><LiveMap readOnly /></Guard>} />
            <Route path="/exec/branches" element={<Guard roles={E}><Branches viewer="executive" /></Guard>} />
            <Route path="/exec/branches/:id" element={<Guard roles={E}><Branches viewer="executive" /></Guard>} />

            <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
        </Routes>
    )
}
