export default async function handler(req, res) {
    // Handling CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id } = req.query;

    // ==========================================
    // TRIO COOKIE VIP (DATA TUMBAL)
    // ==========================================
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const DS_USER_ID = "65092514569";
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc";

    // ANTI RATE LIMIT BASIC: Acak User-Agent biar gak gampang di-flag spam bot
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/114.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36"
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const headers = {
        "User-Agent": randomUA,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": CSRF_TOKEN,
        "Cookie": `sessionid=${SESSION_ID}; ds_user_id=${DS_USER_ID}; csrftoken=${CSRF_TOKEN};`,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        // ---------------------------------------------------------
        // LOGIKA 1: DOWNLOAD ISI HIGHLIGHT TERTENTU (Dari Code 1)
        // ---------------------------------------------------------
        if (highlight_id) {
            const hMediaUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`;
            const hRes = await fetch(hMediaUrl, { headers });
            const hData = await hRes.json();
            const items = hData.reels_media[0]?.items || [];
            
            return res.status(200).json({
                success: true,
                type: "highlight_items",
                items: items.map(i => ({
                    id: i.id,
                    type: i.media_type === 1 ? "image" : "video",
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url
                }))
            });
        }

        if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

        // ---------------------------------------------------------
        // LOGIKA 2: SCRAPE REELS / POSTS DIRECT (Fitur Baru)
        // Cek apakah URL adalah link Reels atau Feed tunggal
        // ---------------------------------------------------------
        if (url.includes('/reel/') || url.includes('/reels/') || url.includes('/p/')) {
            // Ambil ID/Shortcode dari URL (misal: C8Axxx)
            const match = url.match(/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/);
            const shortcode = match ? match[1] : null;

            if (!shortcode) throw new Error("Gagal ngambil kode unik dari link Reels lu.");

            // Trik khusus: nambahin __a=1&__d=dis buat dapet raw JSON dari 1 postingan + dipaduin Cookie VIP
            const reelRes = await fetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, { headers });
            const reelData = await reelRes.json();

            // IG punya 2 jenis format response JSON untuk trick ini, kita handle dua-duanya
            const item = reelData.items ? reelData.items[0] : (reelData.graphql ? reelData.graphql.shortcode_media : null);

            if (!item) throw new Error("Data Reels gak ketemu. Mungkin akunnya private atau videonya udah dihapus.");

            let raw_url = "";
            let type = "image";

            // Deteksi link mentahan MP4
            if (item.video_versions && item.video_versions.length > 0) {
                raw_url = item.video_versions[0].url;
                type = "video";
            } else if (item.is_video && item.video_url) {
                raw_url = item.video_url;
                type = "video";
            } else if (item.image_versions2) {
                raw_url = item.image_versions2.candidates[0].url; // Kalau ternyata link gambar
            } else {
                raw_url = item.display_url;
            }

            return res.status(200).json({
                success: true,
                type: "reel_or_post_download",
                shortcode: shortcode,
                media_type: type,
                raw_url: raw_url
            });
        }

        // ---------------------------------------------------------
        // LOGIKA 3: SCRAPE PROFIL LENGKAP (Gabungan Post Code 2 + Story Code 1)
        // ---------------------------------------------------------
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        if (!username) throw new Error("Username gak ketemu dari link.");

        // 1. Ambil Profil & Timeline Postingan
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileResponse = await fetch(profileUrl, { headers });
        if (!profileResponse.ok) throw new Error(`IG menolak akses (Status: ${profileResponse.status}). Kena rate limit/cookie mati.`);

        const profileData = await profileResponse.json();
        if (!profileData?.data?.user) throw new Error("Akun tidak ditemukan atau di-private sepenuhnya");

        const user = profileData.data.user;
        const userId = user.id;

        // Bedah Postingan (DIAMBIL DARI KODE 2 YANG LU BILANG JALAN)
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const posts = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];
            if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children) {
                children = node.edge_sidecar_to_children.edges.map(child => {
                    const cNode = child.node;
                    return {
                        id: cNode.id,
                        type: cNode.__typename,
                        url: cNode.is_video ? cNode.video_url : cNode.display_url
                    };
                });
            }
            return {
                id: node.id,
                shortcode: node.shortcode,
                type: node.__typename,
                thumbnail: node.display_url,
                video_url: node.video_url || null,
                carousel_items: children // Semua slide ada di sini
            };
        });

        // 2. Ambil Stories & Highlight Tray PAKE COOKIE VIP (Dari Code 1) biar gak ribet pake GraphQL publik
        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers }),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers })
        ]);

        let active_stories = [];
        if (storyRes.ok) {
            const sData = await storyRes.json();
            active_stories = (sData.reels_media[0]?.items || []).map(i => ({
                id: i.id,
                type: i.media_type === 1 ? "image" : "video",
                url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url
            }));
        }

        let highlight_tray = [];
        if (highlightRes.ok) {
            const hData = await highlightRes.json();
            highlight_tray = (hData.tray || []).map(t => ({
                id: t.id.split(':')[1] || t.id,
                title: t.title,
                cover: t.cover_media?.cropped_image_version?.url || null,
                media_count: t.media_count
            }));
        }

        // Return Data Gabungan
        return res.status(200).json({
            success: true,
            extracted_username: username,
            profile: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                total_posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            },
            data: {
                posts,
                stories: active_stories,
                highlights: highlight_tray
            }
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: "Gagal menyedot data bro", 
            error: error.message 
        });
    }
}
