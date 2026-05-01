export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id } = req.query;

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
        "Referer": "https://www.instagram.com/",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        if (highlight_id) {
            const hRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`, { headers });
            const hData = await hRes.json();
            const items = hData.reels_media[0]?.items || [];
            return res.status(200).json({
                success: true,
                items: items.map(i => ({
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url,
                    is_video: i.media_type !== 1
                }))
            });
        }

        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        // 1. AMBIL PROFIL & SEMUA JENIS TIMELINE
        const profileRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers });
        const profileData = await profileRes.json();
        const user = profileData.data.user;
        const userId = user.id;

        // GABUNGIN GRID BIASA + VIDEO TIMELINE (REELS)
        const gridEdges = user.edge_owner_to_timeline_media.edges || [];
        const videoEdges = user.edge_felix_video_timeline?.edges || [];
        const allEdges = [...gridEdges, ...videoEdges];

        // Hapus duplikat berdasarkan ID
        const uniqueEdges = Array.from(new Map(allEdges.map(item => [item.node.id, item])).values());

        const posts = uniqueEdges.map(edge => {
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

        // 2. STORIES & HIGHLIGHTS
        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers }),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers })
        ]);

        let stories = [];
        if (storyRes.ok) {
            const sData = await storyRes.json();
            stories = (sData.reels_media[0]?.items || []).map(i => ({
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
