const fetch = require('node-fetch');

async function searchSuperPSX(query) {
    try {
        const url = 'https://www.superpsx.com/?s=' + encodeURIComponent(query);
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        
        let imageUrl = null;
        
        const imgMatch = html.match(/data-bgset="([^"]+)"/);
        if (imgMatch && imgMatch[1]) {
            imageUrl = imgMatch[1];
        } else {
            const ogMatch = html.match(/<meta property="og:image"\s+content="([^"]+)"/i);
            if (ogMatch && ogMatch[1] && !ogMatch[1].includes('SUPERPSX-500')) {
                imageUrl = ogMatch[1];
            }
        }
        
        console.log("Query: " + query + " -> " + imageUrl);
    } catch(e) {
        console.error(e);
    }
}

async function run() {
    await searchSuperPSX("pes 2018");
    await searchSuperPSX("God of war 3");
    await searchSuperPSX("UFC 4");
    process.exit();
}

run();
