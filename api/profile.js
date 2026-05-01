export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

    // ==========================================
    // MASUKIN DATA TUMBAL LU DI SINI
    // ==========================================
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const DS_USER_ID = "65092514569"; // Ambil dari cookie ds_user_id
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc"; // Ambil dari cookie csrftoken

    try {
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        // Header Full Auth (Nyamar jadi Browser Login)
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

        // 1. Ambil Profil & Grid
        const profileRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers });
        if (!profileRes.ok) throw new Error(`Profil Gagal (Status: ${profileRes.status})`);
        
        const profileData = await profileRes.json();
        const user = profileData.data.user;
        const userId = user.id;

        // Bedah Grid (Posts/Reels/Carousel)
        const grid = (user.edge_owner_to_timeline_media.edges || []).map(edge => {
            const node = edge.node;
            let slides = [];
            if (node.edge_sidecar_to_children) {
                slides = node.edge_sidecar_to_children.edges.map(c => ({
                    url: c.node.is_video ? c.node.video_url : c.node.display_url,
                    is_video: c.node.is_video
                }));
            }
            return {
                id: node.id,
                type: node.__typename,
                thumbnail: node.display_url,
                video_url: node.video_url || null,
                slides: slides
            };
        });

        // 2. Ambil Stories & Highlights Tray
        let stories = [];
        let highlights = [];

        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers }),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers })
        ]);

        if (storyRes.ok) {
            const sData = await storyRes.json();
            const items = sData.reels_media[0]?.items || [];
            stories = items.map(i => ({
                url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                is_video: i.media_type !== 1
            }));
        }

        if (highlightRes.ok) {
            const hData = await highlightRes.json();
            highlights = (hData.tray || []).map(t => ({
                id: t.id,
                title: t.title,
                cover: t.cover_media.cropped_image_version.url
            }));
        }

        res.status(200).json({
            success: true,
            profile: {
                full_name: user.full_name,
                profile_pic: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count
            },
            data: { posts: grid, stories, highlights }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
