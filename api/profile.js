export default async function handler(req, res) {
    // Setting CORS biar aman ditarik sama aplikasi Android/Kotlin lu
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "Link Instagram-nya mana bro?" });
    }

    // ==========================================
    // KUNCI VIP (SESSION ID AKUN TUMBAL)
    // ==========================================
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    
    try {
        let username = "";
        
        // Pembersih Link
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        if (!username) throw new Error("Gagal nemuin username dari link");

        // Header standar (Penting banget biar gak kena 400 Bad Request)
        const baseHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            "X-IG-App-ID": "936619743392459",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        };

        // Header VIP (Pake Cookie Tumbal buat Story & Highlight)
        const vipHeaders = {
            ...baseHeaders,
            "Cookie": `sessionid=${SESSION_ID};`
        };

        // ==========================================
        // 1. TEMBAK PROFIL & GRID (POSTS/REELS)
        // ==========================================
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileRes = await fetch(profileUrl, { headers: baseHeaders });
        
        if (!profileRes.ok) throw new Error(`IG nolak akses Profil (Status: ${profileRes.status})`);
        
        const profileData = await profileRes.json();
        if (!profileData?.data?.user) throw new Error("Akun gak ketemu atau Private");
        
        const user = profileData.data.user;
        const userId = user.id;

        // Bedah Grid (Post & Reels) + FIX CAROUSEL/SLIDE
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const grid_media = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];

            // Bongkar isinya kalau dia bentuknya Slide (GraphSidecar)
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
                carousel_items: children // Data slide masuk sini bro!
            };
        });

        // ==========================================
        // 2. TEMBAK STORIES & HIGHLIGHTS BARENGAN
        // ==========================================
        let stories = [];
        let highlights = [];
        let debug_info = {}; // Buat ngelacak masalah

        const [storyRes, highlightRes] = await Promise.all([
            fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, { headers: vipHeaders }).catch(e => e),
            fetch(`https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`, { headers: vipHeaders }).catch(e => e)
        ]);

        // Simpen statusnya biar kita tau nembus apa ditolak
        debug_info.story_status = storyRes?.status || "Error Fetch";
        debug_info.highlight_status = highlightRes?.status || "Error Fetch";

        // Parsing Stories
        if (storyRes && storyRes.ok) {
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

        // Parsing Highlights (Sorotan)
        if (highlightRes && highlightRes.ok) {
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

        // ==========================================
        // 3. OUTPUT FINAL JSON
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
            },
            debug: debug_info // <--- CEK BAGIAN INI NANTI
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Mesin gagal nyedot data",
            error: error.message
        });
    }
}
