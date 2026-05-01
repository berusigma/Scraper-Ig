export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "Link Instagram-nya mana bro?" });
    }

    // SESSION ID LU
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";

    try {
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        if (!username) throw new Error("Gagal nemuin username");

        const baseHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            "X-IG-App-ID": "936619743392459",
            "Accept-Language": "en-US,en;q=0.9"
        };

        const vipHeaders = {
            ...baseHeaders,
            "Cookie": `sessionid=${SESSION_ID};`
        };

        // ==========================================
        // 1. TEMBAK PROFIL & POSTINGAN GRID
        // ==========================================
        const profileRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers: baseHeaders });
        if (!profileRes.ok) throw new Error(`IG nolak akses Profil (Status: ${profileRes.status})`);
        
        const profileData = await profileRes.json();
        const user = profileData.data.user;
        const userId = user.id;

        // BONGKAR POSTINGAN (Termasuk Carousel/Slide)
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const grid_media = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];

            // Kalau postingannya Slide/Carousel, bongkar semua isinya!
            if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children) {
                children = node.edge_sidecar_to_children.edges.map(child => {
                    const cNode = child.node;
                    return {
                        id: cNode.id,
                        type: cNode.__typename, // GraphImage atau GraphVideo
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
                carousel_items: children // <--- ISI FOTO/VIDEO SLIDE ADA DI SINI
            };
        });

        // ==========================================
        // 2. TEMBAK STORIES & HIGHLIGHTS
        // ==========================================
        let stories = [];
        let highlights = [];

        // Fetch Story
        try {
            const storyRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers: vipHeaders });
            if (storyRes.ok) {
                const storyData = await storyRes.json();
                const reels = storyData.reels_media[0];
                if (reels && reels.items) {
                    stories = reels.items.map(item => ({
                        id: item.id,
                        type: item.media_type === 1 ? "image" : "video",
                        url: item.media_type === 1 ? item.image_versions2?.candidates[0]?.url : item.video_versions?.[0]?.url,
                        taken_at: item.taken_at
                    }));
                }
            }
        } catch (e) { console.log("Gagal tarik story"); }

        // Fetch Highlights
        try {
            const highlightRes = await fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers: vipHeaders });
            if (highlightRes.ok) {
                const highlightData = await highlightRes.json();
                if (highlightData.tray) {
                    highlights = highlightData.tray.map(trayItem => ({
                        id: trayItem.id,
                        title: trayItem.title,
                        cover_url: trayItem.cover_media?.cropped_image_version?.url || null,
                        media_count: trayItem.media_count
                    }));
                }
            }
        } catch (e) { console.log("Gagal tarik highlight"); }

        // ==========================================
        // OUTPUT FINAL
        // ==========================================
        res.status(200).json({
            success: true,
            extracted_username: username,
            profile: {
                id: user.id,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                total_posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            },
            data: {
                posts: grid_media,
                stories: stories,
                highlights: highlights
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
