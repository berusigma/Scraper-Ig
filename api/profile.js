const Insta = require('scraper-instagram');
const InstaClient = new Insta();

export default async function handler(req, res) {
    // Setting CORS biar aplikasi Kotlin (HP lu) bisa ngakses API ini
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Nangkep username dari URL (Contoh: /api/profile?username=rayywashere_)
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ 
            success: false, 
            message: "Username harus diisi bos!" 
        });
    }

    try {
        // Menjalankan fungsi getProfile persis seperti di dokumentasi NPM-nya
        const profile = await InstaClient.getProfile(username);
        
        // Lu juga bisa nambahin getProfileStory kalau butuh (opsional)
        // const story = await InstaClient.getProfileStory(username).catch(() => null);

        // Kalau sukses, kirim datanya ke aplikasi lu
        res.status(200).json({
            success: true,
            data: {
                id: profile.id,
                username: profile.name,
                bio: profile.bio,
                profile_pic: profile.pic,
                followers: profile.followers,
                following: profile.following,
                posts: profile.posts,
                last_posts: profile.lastPosts // Ini isinya array foto-foto terakhir
            }
        });

    } catch (error) {
        // Sesuai dokumentasi, kalau error biasanya karena 406 (Parsing Error) atau 401 (Butuh Login)
        res.status(500).json({
            success: false,
            message: "Gagal narik data dari Instagram",
            error: error.message || error
        });
    }
}
