export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id } = req.query;

    // DATA TUMBAL (Trio Cookie Lu)
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc";

    const commonHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": CSRF_TOKEN,
        "Cookie": `sessionid=${SESSION_ID}; csrftoken=${CSRF_TOKEN};`,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.instagram.com",
        "Referer": "https://www.instagram.com/",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        // --- FITUR: ISI HIGHLIGHT ---
        if (highlight_id) {
            const hRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`, { headers: commonHeaders });
            const hData = await hRes.json();
            return res.status(200).json({
                success: true,
                items: (hData.reels_media[0]?.items || []).map(i => ({
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                    is_video: i.media_type !== 1
                }))
            });
        }

        if (!url) return res.status(400).json({ success: false, message: "URL kosong" });

        let username = url.includes("instagram.com") 
            ? new URL(url).pathname.replace(/\//g, '').trim() 
            : url.replace('@', '').trim();

        // --- 1. AMBIL PROFIL & POSTINGAN (DENGAN FALLBACK) ---
        let profileRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers: commonHeaders });
        let profileData = await profileRes.json();
        
        // Jika data postingan kosong, coba panggil ulang pake endpoint berbeda
        if (!profileData?.data?.user?.edge_owner_to_timeline_media?.edges?.length) {
            const fallbackRes = await fetch(`https://www.instagram.com/${username}/?__a=1&__d=dis`, { headers: commonHeaders });
            const fallbackData = await fallbackRes.json();
            if (fallbackData?.graphql?.user) {
                profileData = { data: { user: fallbackData.graphql.user } };
            }
        }

        const user = profileData?.data?.user;
        if (!user) throw new Error("User tidak ditemukan atau Session mati");

        const userId = user.id;

        // Bongkar Postingan & Reels
        const posts = (user.edge_owner_to_timeline_media?.edges || []).map(edge => {
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
                shortcode: node.shortcode,
                thumbnail: node.display_url,
                video_url: node.video_url || null,
                is_video: node.is_video,
                caption: node.edge_media_to_caption?.edges[0]?.node?.text || "",
                slides: slides
            };
        });

        // --- 2. AMBIL STORIES & HIGHLIGHTS (TERPISAH BIAR GAK CRASH SEMUA) ---
        let stories = [];
        let highlights = [];

        try {
            const storyRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers: commonHeaders });
            if (storyRes.ok) {
                const sData = await storyRes.json();
                stories = (sData.reels_media[0]?.items || []).map(i => ({
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                    is_video: i.media_type !== 1
                }));
            }
        } catch (e) { console.error("Story failed"); }

        try {
            const highlightRes = await fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers: commonHeaders });
            if (highlightRes.ok) {
                const hData = await highlightRes.json();
                highlights = (hData.tray || []).map(t => ({
                    id: t.id.split(':')[1] || t.id,
                    title: t.title,
                    cover: t.cover_media?.cropped_image_version?.url || t.cover_media?.display_url
                }));
            }
        } catch (e) { console.error("Highlight failed"); }

        // --- OUTPUT FINAL ---
        res.status(200).json({
            success: true,
            profile: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic: user.profile_pic_url_hd,
                followers: user.edge_followed_by?.count,
                following: user.edge_follow?.count,
                posts_count: user.edge_owner_to_timeline_media?.count
            },
            data: { posts, stories, highlights }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
