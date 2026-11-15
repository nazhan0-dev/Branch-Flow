-- Branch Logistics — โครงสร้างฐานข้อมูล (MySQL 8)
-- สร้างฐานข้อมูลก่อน: CREATE DATABASE branch_logistics CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notification, location_ping, trip_stop, trip, vehicle, request_item, replenish_request,
  pos_sale, stock_movement, branch_stock, warehouse_stock, product, user, branch;
SET FOREIGN_KEY_CHECKS = 1;

-- สาขา (พิกัดใช้วางหมุดบนแผนที่และคำนวณเส้นทาง)
CREATE TABLE branch (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  region VARCHAR(50) NOT NULL,
  address VARCHAR(255),
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  is_warehouse TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1   -- 0 = ปิดสาขา (พนักงานล็อกอินไม่ได้ ไม่ร่างคำขอ ประวัติยังอยู่)
) ENGINE=InnoDB;

-- ผู้ใช้ 4 บทบาท: branch = พนักงานสาขา, admin = Admin คลัง, driver = พนักงานขนส่ง, executive = ผู้บริหาร
CREATE TABLE user (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(120) NOT NULL UNIQUE,
  password VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  role ENUM('branch','admin','driver','executive') NOT NULL,
  branch_id INT NULL,               -- ใช้เฉพาะ role = branch
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  default_vehicle_id INT NULL,      -- รถประจำของคนขับ (FK ใส่หลังสร้างตาราง vehicle)
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (branch_id) REFERENCES branch(id)
) ENGINE=InnoDB;

CREATE TABLE product (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(50) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'ชิ้น',
  weight_kg DECIMAL(8,3) NOT NULL DEFAULT 0.1,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  branch_reorder_point INT NOT NULL DEFAULT 10,  -- ค่ามาตรฐานของสาขา ใช้ตั้งสต็อกให้สาขาที่เปิดใหม่
  branch_max_qty INT NOT NULL DEFAULT 50
) ENGINE=InnoDB;

-- สต็อกคลังกลาง: reserved_qty = จองไว้ให้คำขอที่อนุมัติแล้วแต่ยังไม่ออกจากคลัง
CREATE TABLE warehouse_stock (
  product_id INT PRIMARY KEY,
  qty INT NOT NULL DEFAULT 0,
  reserved_qty INT NOT NULL DEFAULT 0,
  reorder_point INT NOT NULL DEFAULT 100,
  FOREIGN KEY (product_id) REFERENCES product(id)
) ENGINE=InnoDB;

-- สต็อกสาขา: qty <= reorder_point → ใกล้หมด, เติมให้ถึง max_qty
-- qty ติดลบได้ (ข้อมูลในระบบอาจไม่ตรงของจริง ไม่ปฏิเสธการขาย แต่แจ้งให้นับสต็อก)
CREATE TABLE branch_stock (
  branch_id INT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  reorder_point INT NOT NULL DEFAULT 10,
  max_qty INT NOT NULL DEFAULT 50,
  PRIMARY KEY (branch_id, product_id),
  FOREIGN KEY (branch_id) REFERENCES branch(id),
  FOREIGN KEY (product_id) REFERENCES product(id)
) ENGINE=InnoDB;

-- ประวัติทุกการเปลี่ยนสต็อก
-- branch_id NULL = คลังกลาง; change บวก = เพิ่ม, ลบ = ลด
CREATE TABLE stock_movement (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  product_id INT NOT NULL,
  `change` INT NOT NULL,
  reason ENUM('sale','receive','waste','return','transfer','adjust','reserve','dispatch','purchase') NOT NULL,
  ref_type VARCHAR(20),
  ref_id BIGINT,
  user_id INT NULL,
  note VARCHAR(255),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_branch_product (branch_id, product_id, created_at),
  FOREIGN KEY (product_id) REFERENCES product(id)
) ENGINE=InnoDB;

-- บิลจาก POS: bill_id ห้ามซ้ำ กันตัดสต็อกสองครั้งเมื่อ POS ส่งบิลเดิมซ้ำ (idempotency)
CREATE TABLE pos_sale (
  bill_id VARCHAR(40) PRIMARY KEY,
  branch_id INT NOT NULL,
  total_items INT NOT NULL,
  sold_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (branch_id) REFERENCES branch(id)
) ENGINE=InnoDB;

-- คำขอเติมสินค้า
-- source: auto = ระบบร่างให้, branch = สาขาสั่งเอง, hq = คลังเสนอ
-- status: draft → pending → approved → in_transit → received (หรือ rejected / cancelled)
CREATE TABLE replenish_request (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(12) NOT NULL UNIQUE,
  branch_id INT NOT NULL,
  source ENUM('auto','branch','hq') NOT NULL,
  status ENUM('draft','pending','approved','in_transit','received','rejected','cancelled') NOT NULL,
  priority ENUM('normal','urgent') NOT NULL DEFAULT 'normal',
  note VARCHAR(255),
  auto_submit_at DATETIME(3) NULL,     -- ร่างอัตโนมัติจะถูกส่งเองเมื่อถึงเวลานี้
  created_by INT NULL,
  approved_by INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  submitted_at DATETIME(3) NULL,
  approved_at DATETIME(3) NULL,
  received_at DATETIME(3) NULL,
  INDEX idx_branch_status (branch_id, status),
  FOREIGN KEY (branch_id) REFERENCES branch(id)
) ENGINE=InnoDB;

CREATE TABLE request_item (
  request_id INT NOT NULL,
  product_id INT NOT NULL,
  qty_requested INT NOT NULL,
  qty_approved INT NULL,
  qty_received INT NULL,
  qty_damaged INT NOT NULL DEFAULT 0,
  PRIMARY KEY (request_id, product_id),
  FOREIGN KEY (request_id) REFERENCES replenish_request(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES product(id)
) ENGINE=InnoDB;

CREATE TABLE vehicle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plate VARCHAR(20) NOT NULL UNIQUE,
  type VARCHAR(30) NOT NULL,
  capacity_kg INT NOT NULL,
  status ENUM('available','in_use','maintenance','retired') NOT NULL DEFAULT 'available'
) ENGINE=InnoDB;
ALTER TABLE user ADD CONSTRAINT fk_user_vehicle FOREIGN KEY (default_vehicle_id) REFERENCES vehicle(id);

-- เที่ยวส่ง: assigned → accepted → on_route → completed (หรือ cancelled)
CREATE TABLE trip (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(12) NOT NULL UNIQUE,
  driver_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  status ENUM('assigned','accepted','on_route','completed','cancelled') NOT NULL DEFAULT 'assigned',
  created_by INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  FOREIGN KEY (driver_id) REFERENCES user(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicle(id)
) ENGINE=InnoDB;

-- จุดส่งในเที่ยว: หนึ่งจุดต่อหนึ่งคำขอ เรียงตาม seq
-- status: pending → arrived → received
CREATE TABLE trip_stop (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  request_id INT NOT NULL UNIQUE,
  seq INT NOT NULL,
  status ENUM('pending','arrived','received') NOT NULL DEFAULT 'pending',
  eta DATETIME(3) NULL,
  arrived_at DATETIME(3) NULL,
  received_at DATETIME(3) NULL,
  proof_url VARCHAR(255),
  FOREIGN KEY (trip_id) REFERENCES trip(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES replenish_request(id)
) ENGINE=InnoDB;

-- พิกัดจากมือถือคนขับ (ส่งทุก 5–10 วินาทีระหว่างเที่ยว)
CREATE TABLE location_ping (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id INT NOT NULL,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  speed DECIMAL(6,2) NULL,
  recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_trip_time (trip_id, recorded_at),
  FOREIGN KEY (trip_id) REFERENCES trip(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notification (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,                  -- ส่งถึงคนเดียว
  role ENUM('branch','admin','driver','executive') NULL,  -- หรือส่งถึงทั้งบทบาท
  branch_id INT NULL,                -- จำกัดเฉพาะสาขา (ใช้กับ role = branch)
  type VARCHAR(30) NOT NULL,
  message VARCHAR(255) NOT NULL,
  link VARCHAR(120),
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_target (role, branch_id, user_id, created_at)
) ENGINE=InnoDB;
