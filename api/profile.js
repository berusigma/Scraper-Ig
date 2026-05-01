export default async function handler(req, res) {
    // Setting CORS biar aman ditarik sama aplikasi Kotlin lu
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Nangkep parameter 'url' dari aplikasi lu
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "Link Instagram-nya mana bro?" });
    }

    try {
        let username = "";

        // 1. LOGIKA PEMBERSIH LINK (Motong ?igsh= dll)
        if (url.includes("instagram.com")) {
            // Kalau yang dimasukin bentuknya link (https://www.instagram.com/rayywashere_?igsh=...)
            const parsedUrl = new URL(url);
            // Ngambil "rayywashere_" dari path "/rayywashere_/"
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            // Kalau yang dimasukin cuma username biasa ("@rayywashere_")
            username = url.replace('@', '').trim();
        }

        if (!username) {
            throw new Error("Gagal nemuin username dari link tersebut.");
        }

        // 2. MESIN PENYEDOT UTAMA (Tembak API Internal IG)
        const targetUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                // Nyamar jadi browser Chrome versi terbaru
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                // Kunci sakti buat buka pintu JSON IG tanpa login
                "X-IG-App-ID": "936619743392459",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin"
            }
        });

        if (!response.ok) {
            throw new Error(`IG nolak akses (Status: ${response.status}) - Coba refresh atau deploy ulang.`);
        }

        const data = await response.json();
        
        if (!data || !data.data || !data.data.user) {
            throw new Error("Akun gak ketemu atau di-private 100%");
        }

        const user = data.data.user;

        // 3. SUSUN DATA BIAR RAPI UNTUK KOTLIN
        res.status(200).json({
            success: true,
            extracted_username: username, // Biar lu tau sistem sukses motong link
            profile: {
                id: user.id,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd, // FOTO RESOLUSI TINGGI
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Mesin gagal nyedot data",
            error: error.message
        });
    }
}
