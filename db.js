const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize tables
async function initTables() {
    try {
        // Games table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS games (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                name_ar VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                size VARCHAR(50) NOT NULL,
                category VARCHAR(50) NOT NULL,
                image TEXT DEFAULT '',
                description TEXT DEFAULT '',
                trailer TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                available BOOLEAN DEFAULT true,
                hard_drive VARCHAR(50) DEFAULT '1',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            ALTER TABLE games 
            ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS trailer TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS available BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS hard_drive VARCHAR(50) DEFAULT '1';
        `).catch(err => console.log('Games column add error:', err.message));

        // Orders table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id VARCHAR(50) PRIMARY KEY,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(50) NOT NULL,
                customer_address TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                games JSONB NOT NULL,
                total_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                discount INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'pending',
                completed_games JSONB DEFAULT '[]',
                admin_notes TEXT DEFAULT '',
                points_awarded BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            ALTER TABLE orders 
            ADD COLUMN IF NOT EXISTS customer_address TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS discount INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS completed_games JSONB DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS admin_notes TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS points_awarded BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `).catch(err => console.log('Orders column add error:', err.message));

        // Customers table (Loyalty Points & OTP)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                phone VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                points INTEGER DEFAULT 0,
                otp_code VARCHAR(10),
                otp_expiry TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            ALTER TABLE customers 
            ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10),
            ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;
        `).catch(err => console.log('OTP columns already exist or error:', err.message));

        // System settings table for tracking initialization
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Indexes
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_category ON games(category)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`);

        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing tables:', error);
    }
}

initTables();

module.exports = pool;
