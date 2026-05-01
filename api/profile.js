export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id } = req.query;

    // DATA TUMBAL (PASTIKAN MASIH AKTIF)
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc";

    // Header Sakti (Hasil sniffing aplikasi Instagram resmi)
    const headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "129477", // ID khusus Android/iOS
        "X-IG-WWW-Claim": "0",
        "X-CSRFToken": CSRF_TOKEN,
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": `sessionid=${SESSION_ID}; csrftoken=${CSRF_TOKEN};`,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com/",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        // FITUR: AMBIL ISI HIGHLIGHT (Jika ada parameter highlight_id)
        if (highlight_id) {
            const hRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`, { headers });
            const hData = await hRes.json();
            const items = hData.reels_media[0]?.items || [];
            return res.status(200).json({
                success: true,
                items: items.map(i => ({
                    id: i.id,
                    type: i.media_type === 1 ? "image" : "video",
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url
                }))
            });
        }

        if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

        // Pembersihan Username
        let username = url.includes("instagram.com") 
            ? new URL(url).pathname.replace(/\//g, '').trim() 
            : url.replace('@', '').trim();

        // 1. TARIK DATA PROFIL & MEDIA (Gunakan Endpoint Mobile biar gak kosong)
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileRes = await fetch(profileUrl, { headers });
        const profileData = await profileRes.json();
        
        if (!profileData?.data?.user) throw new Error("Gagal tarik profil. Session mungkin expired.");
        
        const user = profileData.data.user;
        const userId = user.id;

        // BONGKAR SEMUA JENIS MEDIA (Posts, Reels, Carousel)
        const timeline = user.edge_owner_to_timeline_media.edges || [];
        const posts = timeline.map(edge => {
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
                video_url: node.video_url || null, // Otomatis Reels dapet link MP4 di sini
                is_video: node.is_video,
                caption: node.edge_media_to_caption?.edges[0]?.node?.text || "",
                slides: slides // Kalau Slide, isinya foto/video banyak
            };
        });

        // 2. TARIK STORIES & HIGHLIGHTS
        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers }),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers })
        ]);

        let stories = [];
        if (storyRes.ok) {
            const sData = await storyRes.json();
            stories = (sData.reels_media[0]?.items || []).map(i => ({
                id: i.id,
                url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                is_video: i.media_type !== 1
            }));
        }

        let highlights = [];
        if (highlightRes.ok) {
            const hData = await highlightRes.json();
            highlights = (hData.tray || []).map(t => ({
                id: t.id.split(':')[1] || t.id,
                title: t.title,
                cover: t.cover_media.cropped_image_version.url
            }));
        }

        res.status(200).json({
            success: true,
            profile: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                posts_count: user.edge_owner_to_timeline_media.count
            },
            data: { posts, stories, highlights }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
