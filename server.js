const express = require('express');
const path = require('path');
const pool = require('./db');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const ordersRouter = require('./routes/orders');
const statsRouter = require('./routes/stats');
const customersRouter = require('./routes/customers');
const customerAuthRouter = require('./routes/customer_auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Seed default games if database is empty and never seeded before
async function initDB() {
    try {
        const seedCheck = await pool.query("SELECT value FROM system_settings WHERE key = 'default_games_seeded'");
        if (seedCheck.rows.length === 0) {
            const gamesCount = await pool.query('SELECT COUNT(*) FROM games');
            if (parseInt(gamesCount.rows[0].count) === 0) {
                const defaultGames = [
                    { id: "ps4_001", name: "Grand Theft Auto V", nameAr: "قراند 5", price: 15000, size: "50 GB", category: "Action", image: "https://upload.wikimedia.org/wikipedia/en/a/a5/Grand_Theft_Auto_V.png", hardDrive: "1" },
                    { id: "ps4_002", name: "EA Sports FC 24", nameAr: "فيفا 24", price: 12000, size: "45 GB", category: "Sports", image: "https://upload.wikimedia.org/wikipedia/en/3/3f/EA_Sports_FC_24_cover.jpg", hardDrive: "1" },
                    { id: "ps4_003", name: "Call of Duty: Modern Warfare", nameAr: "كول اوف ديوتي", price: 18000, size: "80 GB", category: "Shooter", image: "https://upload.wikimedia.org/wikipedia/en/1/1f/Call_of_Duty_Modern_Warfare_%282019%29_cover.png", hardDrive: "2" },
                    { id: "ps4_004", name: "Marvel's Spider-Man", nameAr: "سبايدر مان", price: 14000, size: "45 GB", category: "Action", image: "https://upload.wikimedia.org/wikipedia/en/e/e1/Spider-Man_PS4_cover.jpg", hardDrive: "2" },
                    { id: "ps4_005", name: "God of War", nameAr: "جود اوف وور", price: 16000, size: "35 GB", category: "Action", image: "https://upload.wikimedia.org/wikipedia/en/a/a7/God_of_War_4_cover.jpg", hardDrive: "3" },
                    { id: "ps4_006", name: "Red Dead Redemption 2", nameAr: "ريد ديد 2", price: 20000, size: "100 GB", category: "Adventure", image: "https://upload.wikimedia.org/wikipedia/en/4/44/Red_Dead_Redemption_II.jpg", hardDrive: "3" },
                    { id: "ps4_007", name: "The Last of Us Part II", nameAr: "ذي لاست اوف اس 2", price: 17000, size: "60 GB", category: "Action", image: "https://upload.wikimedia.org/wikipedia/en/4/4f/The_Last_of_Us_Part_II_cover.jpg", hardDrive: "4" },
                    { id: "ps4_008", name: "Horizon Zero Dawn", nameAr: "هورايزن", price: 13000, size: "40 GB", category: "Adventure", image: "https://upload.wikimedia.org/wikipedia/en/9/93/Horizon_Zero_Dawn.jpg", hardDrive: "4" },
                    { id: "ps4_009", name: "Uncharted 4", nameAr: "انشارتد 4", price: 14000, size: "50 GB", category: "Adventure", image: "https://upload.wikimedia.org/wikipedia/en/1/1a/Uncharted_4_box_artwork.jpg", hardDrive: "5" },
                    { id: "ps4_010", name: "Bloodborne", nameAr: "بلادبورن", price: 15000, size: "30 GB", category: "RPG", image: "https://upload.wikimedia.org/wikipedia/en/6/68/Bloodborne_Cover_Wallpaper.jpg", hardDrive: "5" },
                    { id: "ps4_011", name: "Mortal Kombat 11", nameAr: "مورتال كومبات 11", price: 11000, size: "40 GB", category: "Fighting", image: "https://upload.wikimedia.org/wikipedia/en/2/21/Mortal_Kombat_11_cover_art.png", hardDrive: "6" },
                    { id: "ps4_012", name: "NBA 2K24", nameAr: "ان بي ايه 2K24", price: 10000, size: "80 GB", category: "Sports", image: "https://upload.wikimedia.org/wikipedia/en/6/6a/NBA_2K24_cover_art.jpg", hardDrive: "6" }
                ];

                for (const game of defaultGames) {
                    await pool.query(
                        'INSERT INTO games (id, name, name_ar, price, size, category, image, hard_drive) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
                        [game.id, game.name, game.nameAr, game.price, game.size, game.category, game.image, game.hardDrive]
                    );
                }
            }
            await pool.query("INSERT INTO system_settings (key, value) VALUES ('default_games_seeded', 'true') ON CONFLICT (key) DO NOTHING");
            console.log('Default games initial seeding completed');
        }
    } catch (error) {
        console.error('Database seeding error:', error);
    }
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/orders', ordersRouter);
app.use('/api/stats', statsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/auth/customer', customerAuthRouter);

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'حدث خطأ في الخادم!' });
});

// Start server
app.listen(PORT, async () => {
    await initDB();
    console.log(`PS4 Catalog Server running on port ${PORT}`);
});
