function testRegex() {
    const html = `<div class="thumbnail">
        <a class="penci-image-holder penci-lazy" data-bgset="https://www.superpsx.com/wp-content/uploads/GTA3.jpg" href="link" title="Grand Theft Auto III PS4 PKG"></a>
    </div>
    <div class="thumbnail">
        <a class="penci-image-holder penci-lazy" data-bgset="https://www.superpsx.com/wp-content/uploads/GTAV.jpg" href="link" title="Grand Theft Auto V PS4 PKG"></a>
    </div>`;

    const regex = /<a[^>]+class="[^"]*penci-image-holder[^"]*"[^>]+data-bgset="([^"]+)"[^>]+title="([^"]+)"/g;
    let match;
    const results = [];
    while ((match = regex.exec(html)) !== null) {
        results.push({ image: match[1], title: match[2] });
    }
    console.log(results);
}
testRegex();
