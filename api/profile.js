export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id } = req.query;

    // ==========================================
    // COOKIE TUMBAL BUAT BUKA STORY/HIGHLIGHT
    // ==========================================
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const DS_USER_ID = "65092514569";
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc";

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": CSRF_TOKEN,
        "Cookie": `sessionid=${SESSION_ID}; ds_user_id=${DS_USER_ID}; csrftoken=${CSRF_TOKEN};`,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        // ==========================================
        // 1. MODE LIHAT ISI HIGHLIGHT TERTENTU (OPTIONAL)
        // ==========================================
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

        // ==========================================
        // 2. MODE UTAMA: SCRAPE PROFIL + POST + STORY + HIGHLIGHT TRAY
        // ==========================================
        if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

        // Bersihin username
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim();
        } else {
            username = url.replace('@', '').trim();
        }
        if (!username) throw new Error("Username gak ketemu dari link.");

        // ----- 2a. Ambil profil + data postingan (pakai cookie) -----
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileRes = await fetch(profileUrl, { headers });
        if (!profileRes.ok) throw new Error(`Gagal akses profil (status: ${profileRes.status})`);

        const profileData = await profileRes.json();
        const user = profileData?.data?.user;
        if (!user) throw new Error("Akun gak ketemu atau di-private total.");

        const userId = user.id;

        // Pakai logika postingan dari kode pertama (TERUJI, PASTI MUNCUL)
        const timelineEdges = user.edge_owner_to_timeline_media?.edges || [];
        const posts = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];

            // Cek kalo ini slide (carousel)
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
                carousel_items: children
            };
        });

        // ----- 2b. Ambil story & highlight tray (pakai cookie) -----
        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers }),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers })
        ]);

        let active_stories = [];
        if (storyRes.ok) {
            const sData = await storyRes.json();
            active_stories = (sData.reels_media?.[0]?.items || []).map(i => ({
                id: i.id,
                url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                is_video: i.media_type !== 1
            }));
        }

        let highlight_tray = [];
        if (highlightRes.ok) {
            const hData = await highlightRes.json();
            highlight_tray = (hData.tray || []).map(t => ({
                id: t.id.includes(':') ? t.id.split(':')[1] : t.id,
                title: t.title,
                cover: t.cover_media?.cropped_image_version?.url || '',
                media_count: t.media_count
            }));
        }

        // ----- 2c. Susun respons akhir -----
        res.status(200).json({
            success: true,
            profile: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic: user.profile_pic_url_hd,
                followers: user.edge_followed_by?.count || 0,
                following: user.edge_follow?.count || 0,
                posts_count: user.edge_owner_to_timeline_media?.count || 0
            },
            data: {
                posts: posts,           // <-- POSTINGAN MUNCUL LAGI
                stories: active_stories,
                highlights: highlight_tray
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
