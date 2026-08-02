const pool = require('./db');

async function test() {
    try {
        const res = await pool.query('SELECT id, name, image, trailer FROM games LIMIT 10');
        console.log("DB Games:");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
